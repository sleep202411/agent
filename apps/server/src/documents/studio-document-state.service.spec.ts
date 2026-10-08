import { StudioDocumentStateService } from './studio-document-state.service';
import { mergeDocumentState } from './document-crdt';

const CANVAS_SCHEMA = {
  meta: 'map',
  nodes: 'map',
  edges: 'map',
  groups: 'map',
  assets: 'map',
} as const;

function fixture() {
  const snapshot = { meta: { title: 'Accepted draft' }, nodes: {} };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    studioDocument: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'doc-1',
        type: 'canvas',
        crdtState: null,
        contentSnapshot: snapshot,
        currentSequence: 4,
        currentVersionId: 'version-1',
      }),
      update: jest.fn(
        (args: {
          where: { id: string };
          data: { crdtState: Buffer; snapshotSequence: number };
        }) => Promise.resolve({ id: args.where.id }),
      ),
    },
    studioDocumentVersion: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    studioDocument: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'doc-1' }])
        .mockResolvedValue([]),
    },
    $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  };
  return {
    prisma,
    tx,
    service: new StudioDocumentStateService(prisma as never),
  };
}

describe('StudioDocumentStateService background isolation', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.BACKGROUND_TASKS_ENABLED;
    delete process.env.BACKGROUND_TASKS_ENABLED;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
    else process.env.BACKGROUND_TASKS_ENABLED = saved;
  });

  it('does not scan or backfill imported documents at boot when disabled', async () => {
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
    const { service, prisma, tx } = fixture();

    await service.onApplicationBootstrap();

    expect(prisma.studioDocument.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.studioDocument.update).not.toHaveBeenCalled();
    expect(tx.studioDocumentVersion.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the existing boot backfill when the switch is omitted', async () => {
    const { service, prisma, tx } = fixture();

    await service.onApplicationBootstrap();

    expect(prisma.studioDocument.findMany).toHaveBeenCalledTimes(2);
    expect(tx.studioDocument.update).toHaveBeenCalledTimes(1);
    expect(tx.studioDocumentVersion.updateMany).toHaveBeenCalledTimes(1);
    const [{ data }] = tx.studioDocument.update.mock.calls[0];
    expect(data.snapshotSequence).toBe(4);
    expect(
      mergeDocumentState(data.crdtState, [], CANVAS_SCHEMA).snapshot,
    ).toMatchObject({ meta: { title: 'Accepted draft' } });
  });

  it('preserves explicit initialization of the requested document when disabled', async () => {
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
    const { service, prisma, tx } = fixture();

    await expect(service.initialize('doc-1')).resolves.toBe(true);

    expect(prisma.studioDocument.findMany).not.toHaveBeenCalled();
    expect(tx.studioDocument.findFirst).toHaveBeenCalledWith({
      where: { id: 'doc-1', deletedAt: null },
    });
    expect(tx.studioDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-1' } }),
    );
    expect(tx.studioDocumentVersion.updateMany).toHaveBeenCalledTimes(1);
  });
});
