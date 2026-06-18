import * as Y from 'yjs';
import { DocumentCompactionService } from './document-compaction.service';
import { mergeDocumentState } from './document-crdt';

const CANVAS_SCHEMA = {
  meta: 'map',
  nodes: 'map',
  edges: 'map',
  assets: 'map',
} as const;

/** No-op autosave dependency — these tests cover compaction mechanics only. */
const noopAutosave = { maybeStamp: () => Promise.resolve() };

interface OpRow {
  sequence: number;
  yjsUpdate: Buffer;
}

/** Build N single-key CRDT ops (meta.k{i} = i); op sequences are 1..N. */
function buildOps(count: number): OpRow[] {
  const doc = new Y.Doc();
  const ops: OpRow[] = [];
  let sequence = 0;
  doc.on('update', (update: Uint8Array) => {
    sequence += 1;
    ops.push({ sequence, yjsUpdate: Buffer.from(update) });
  });
  for (let i = 1; i <= count; i += 1) {
    Y.transact(doc, () => doc.getMap('meta').set(`k${i}`, i));
  }
  doc.destroy();
  return ops;
}

function expectedSnapshot(count: number): Record<string, unknown> {
  const meta: Record<string, number> = {};
  for (let i = 1; i <= count; i += 1) meta[`k${i}`] = i;
  // The canvas root schema declares meta/nodes/edges/assets; unused roots
  // materialize as empty maps.
  return { meta, nodes: {}, edges: {}, assets: {} };
}

interface DocState {
  type: string;
  crdtState: Buffer | null;
  contentSnapshot: unknown;
  snapshotSequence: number;
  currentSequence: number;
  deletedAt: Date | null;
}

function makePrisma(init: {
  currentSequence: number;
  ops: OpRow[];
  snapshotSequence?: number;
  crdtState?: Buffer | null;
  deletedAt?: Date | null;
  forceSupersede?: boolean;
}) {
  const doc: DocState = {
    type: 'canvas',
    crdtState: init.crdtState ?? null,
    contentSnapshot: {},
    snapshotSequence: init.snapshotSequence ?? 0,
    currentSequence: init.currentSequence,
    deletedAt: init.deletedAt ?? null,
  };
  const ops = [...init.ops].sort((a, b) => a.sequence - b.sequence);

  const findUnique = jest.fn(() => Promise.resolve({ ...doc }));
  const findMany = jest.fn(
    ({
      where,
      take,
    }: {
      where: { sequence: { gt: number; lte: number } };
      take: number;
    }) =>
      Promise.resolve(
        ops
          .filter(
            (op) =>
              op.sequence > where.sequence.gt &&
              op.sequence <= where.sequence.lte,
          )
          .slice(0, take)
          .map((op) => ({ sequence: op.sequence, yjsUpdate: op.yjsUpdate })),
      ),
  );
  const updateMany = jest.fn(
    ({
      where,
      data,
    }: {
      where: { snapshotSequence: { lt: number } };
      data: {
        crdtState: Buffer;
        contentSnapshot: unknown;
        snapshotSequence: number;
        lastCompactedAt: Date;
      };
    }) => {
      if (init.forceSupersede) return Promise.resolve({ count: 0 });
      if (!(doc.snapshotSequence < where.snapshotSequence.lt)) {
        return Promise.resolve({ count: 0 });
      }
      doc.crdtState = data.crdtState;
      doc.contentSnapshot = data.contentSnapshot;
      doc.snapshotSequence = data.snapshotSequence;
      return Promise.resolve({ count: 1 });
    },
  );

  const deleteMany = jest.fn(
    ({ where }: { where: { sequence: { lte: number } } }) =>
      Promise.resolve({
        count: ops.filter((op) => op.sequence <= where.sequence.lte).length,
      }),
  );

  const prisma = {
    platformDocument: { findUnique, updateMany },
    platformDocumentOperation: { findMany, deleteMany },
  };
  return {
    prisma,
    doc,
    calls: { findUnique, findMany, updateMany, deleteMany },
  };
}

describe('DocumentCompactionService', () => {
  const ENV_KEYS = [
    'DOCUMENT_COMPACTION_MAX_OPS_PER_RUN',
    'DOCUMENT_OP_PRUNE_ENABLED',
    'DOCUMENT_OP_PRUNE_RETENTION',
  ];
  const envKey = 'DOCUMENT_COMPACTION_MAX_OPS_PER_RUN';
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('folds the whole op tail into crdtState + contentSnapshot in one run', async () => {
    const ops = buildOps(4);
    const { prisma, doc, calls } = makePrisma({ currentSequence: 4, ops });
    const service = new DocumentCompactionService(
      prisma as never,
      noopAutosave as never,
    );

    service.schedule('doc-1');
    await service.flush('doc-1');

    expect(calls.updateMany).toHaveBeenCalledTimes(1);
    expect(doc.snapshotSequence).toBe(4);
    expect(doc.contentSnapshot).toEqual(expectedSnapshot(4));
    // The persisted binary state must materialize to the same snapshot.
    expect(
      mergeDocumentState(doc.crdtState, [], CANVAS_SCHEMA).snapshot,
    ).toEqual(expectedSnapshot(4));
  });

  it('is a no-op when the snapshot already covers the current sequence', async () => {
    const { prisma, calls } = makePrisma({
      currentSequence: 3,
      snapshotSequence: 3,
      ops: buildOps(3),
    });
    const service = new DocumentCompactionService(
      prisma as never,
      noopAutosave as never,
    );

    service.schedule('doc-1');
    await service.flush('doc-1');

    expect(calls.findUnique).toHaveBeenCalledTimes(1);
    expect(calls.findMany).not.toHaveBeenCalled();
    expect(calls.updateMany).not.toHaveBeenCalled();
  });

  it('coalesces a burst of schedule() calls into a single run', async () => {
    const { prisma, calls } = makePrisma({
      currentSequence: 2,
      ops: buildOps(2),
    });
    const service = new DocumentCompactionService(
      prisma as never,
      noopAutosave as never,
    );

    service.schedule('doc-1');
    service.schedule('doc-1');
    service.schedule('doc-1');
    expect(calls.findUnique).not.toHaveBeenCalled(); // debounced, not yet run

    await service.flush('doc-1');
    expect(calls.findUnique).toHaveBeenCalledTimes(1);
  });

  it('drains a long tail across multiple partial runs (op budget)', async () => {
    process.env[envKey] = '2';
    const ops = buildOps(5);
    const { prisma, doc, calls } = makePrisma({ currentSequence: 5, ops });
    const service = new DocumentCompactionService(
      prisma as never,
      noopAutosave as never,
    );

    service.schedule('doc-1');
    await service.flush('doc-1');

    expect(calls.updateMany).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(doc.snapshotSequence).toBe(5);
    expect(
      mergeDocumentState(doc.crdtState, [], CANVAS_SCHEMA).snapshot,
    ).toEqual(expectedSnapshot(5));
  });

  it('tolerates a superseded (concurrent) compaction without throwing', async () => {
    const { prisma } = makePrisma({
      currentSequence: 3,
      ops: buildOps(3),
      forceSupersede: true,
    });
    const service = new DocumentCompactionService(
      prisma as never,
      noopAutosave as never,
    );

    service.schedule('doc-1');
    await expect(service.flush('doc-1')).resolves.toBeUndefined();
  });

  it('skips deleted documents', async () => {
    const { prisma, calls } = makePrisma({
      currentSequence: 3,
      ops: buildOps(3),
      deletedAt: new Date(),
    });
    const service = new DocumentCompactionService(
      prisma as never,
      noopAutosave as never,
    );

    service.schedule('doc-1');
    await service.flush('doc-1');

    expect(calls.findMany).not.toHaveBeenCalled();
    expect(calls.updateMany).not.toHaveBeenCalled();
  });

  it('does not prune op rows by default', async () => {
    const { prisma, calls } = makePrisma({
      currentSequence: 5,
      ops: buildOps(5),
    });
    const service = new DocumentCompactionService(
      prisma as never,
      noopAutosave as never,
    );

    service.schedule('doc-1');
    await service.flush('doc-1');

    expect(calls.deleteMany).not.toHaveBeenCalled();
  });

  it('prunes op rows below the retention margin when enabled', async () => {
    process.env.DOCUMENT_OP_PRUNE_ENABLED = 'true';
    process.env.DOCUMENT_OP_PRUNE_RETENTION = '1';
    const { prisma, calls } = makePrisma({
      currentSequence: 5,
      ops: buildOps(5),
    });
    const service = new DocumentCompactionService(
      prisma as never,
      noopAutosave as never,
    );

    service.schedule('doc-1');
    await service.flush('doc-1');

    // horizon advanced to 5, retention 1 → prune ops with sequence ≤ 4.
    expect(calls.deleteMany).toHaveBeenCalledTimes(1);
    expect(calls.deleteMany.mock.calls[0][0]).toEqual({
      where: { documentId: 'doc-1', sequence: { lte: 4 } },
    });
  });
});
