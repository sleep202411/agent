import { CdnPurgeWorkerService } from './cdn-purge-worker.service';
import { MediaTakedownWorkerService } from './media-takedown-worker.service';

type Row = { id: string; lockedAt: Date; lockedBy: string };
function harness(kind: 'cdn' | 'takedown') {
  const ids = ['first', 'second', 'third'];
  const leases = new Map<string, Row>();
  const model = {
    findMany: jest.fn(
      (args: { where: { id?: { in: string[] } }; take?: number }) =>
        Promise.resolve(
          args.where.id
            ? args.where.id.in.map((id) => leases.get(id)!)
            : ids
                .filter((id) => !leases.has(id))
                .slice(0, args.take)
                .map((id) => ({ id })),
        ),
    ),
    updateMany: jest.fn(
      (args: {
        where: { id: { in: string[] } };
        data: { lockedAt: Date; lockedBy: string };
      }) => {
        for (const id of args.where.id.in) leases.set(id, { id, ...args.data });
        return Promise.resolve({ count: args.where.id.in.length });
      },
    ),
  };
  const prisma = { mediaModerationAction: model };
  const worker =
    kind === 'cdn'
      ? new CdnPurgeWorkerService(prisma as never, {} as never, {} as never)
      : new MediaTakedownWorkerService(
          prisma as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );
  const internal = worker as unknown as {
    purgeOne(row: Row): Promise<void>;
    runOne(row: Row): Promise<void>;
  };
  const run = jest.spyOn(internal, kind === 'cdn' ? 'purgeOne' : 'runOne');
  return { worker, run, leases, model };
}

describe.each(['cdn', 'takedown'] as const)('%s action admission', (kind) => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('leases the next item only after active work finishes and respects the sweep limit', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse('2026-09-14T00:00:00Z'));
    const { worker, run, leases, model } = harness(kind);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    run.mockImplementation((row) => {
      if (row.id === 'first') {
        entered();
        return gate;
      }
      return Promise.resolve();
    });
    const draining = worker.drainOnce(2);
    await started;
    try {
      expect([...leases.keys()]).toEqual(['first']);
      expect(model.updateMany).toHaveBeenCalledTimes(1);
      jest.setSystemTime(Date.parse('2026-09-14T00:05:00Z'));
    } finally {
      release();
    }
    await draining;
    expect([...leases.keys()]).toEqual(['first', 'second']);
    expect(leases.get('second')?.lockedAt.toISOString()).toBe(
      '2026-09-14T00:05:00.000Z',
    );
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('does not claim queued items after shutdown during active processing', async () => {
    const { worker, run, leases } = harness(kind);
    run.mockImplementation(() => {
      worker.onModuleDestroy();
      return Promise.resolve();
    });
    await worker.drainOnce(3);
    expect([...leases.keys()]).toEqual(['first']);
    expect(run).toHaveBeenCalledTimes(1);
    await worker.drainOnce(3);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
