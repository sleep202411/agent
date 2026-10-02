import { CdnPurgeWorkerService } from './cdn-purge-worker.service';
import { MediaTakedownWorkerService } from './media-takedown-worker.service';
import { MediaProcessingWorkerService } from './media-processing-worker.service';

// Provider execution is controlled by spies in these lifecycle tests.
jest.mock('../infra/storage/imm-transcode.service', () => ({
  ImmTranscodeService: class {},
}));

type Worker = {
  drainOnce: (batch?: number) => Promise<void>;
  onModuleDestroy: () => void;
  claim: (batch: number) => Promise<unknown[]>;
  purgeOne?: (row: unknown) => Promise<void>;
  runOne?: (row: unknown) => Promise<void>;
  processOne?: (row: unknown) => Promise<void>;
};
const cases = [
  {
    name: 'CDN purge',
    create: (db: unknown) =>
      new CdnPurgeWorkerService(
        db as never,
        undefined as never,
        undefined as never,
      ),
    method: 'purgeOne' as const,
  },
  {
    name: 'takedown',
    create: (db: unknown) =>
      new MediaTakedownWorkerService(
        db as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    method: 'runOne' as const,
  },
  {
    name: 'processing',
    create: (db: unknown) =>
      new MediaProcessingWorkerService(
        db as never,
        undefined as never,
        undefined as never,
      ),
    method: 'processOne' as const,
  },
];
describe.each(cases)('$name shutdown', ({ create, method }) => {
  it('claims only the next job while processing and preserves the batch limit', async () => {
    const worker = create(undefined) as unknown as Worker;
    const queue = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
    const claim = jest
      .spyOn(worker, 'claim')
      .mockImplementation((batch) => Promise.resolve(queue.splice(0, batch)));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const process = jest
      .spyOn(worker, method)
      .mockResolvedValue(undefined)
      .mockReturnValueOnce(pending);
    const draining = worker.drainOnce(2);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(claim).toHaveBeenCalledTimes(1);
      expect(claim).toHaveBeenCalledWith(1);
      expect(queue).toHaveLength(2);
    } finally {
      release();
      await draining;
    }
    expect(process).toHaveBeenCalledTimes(2);
    expect(queue).toEqual([{ id: 'third' }]);
  });

  it('does not claim or dispatch after shutdown during candidate lookup', async () => {
    let finish!: (rows: { id: string }[]) => void;
    const findMany = jest.fn(
      () =>
        new Promise<{ id: string }[]>((resolve) => {
          finish = resolve;
        }),
    );
    const updateMany = jest.fn();
    const model = { findMany, updateMany };
    const worker = create({
      mediaModerationAction: model,
      mediaProcessingJob: model,
    }) as unknown as Worker;
    const process = jest.spyOn(worker, method).mockResolvedValue(undefined);
    const pending = worker.drainOnce();
    worker.onModuleDestroy();
    finish([{ id: 'queued' }]);
    await pending;
    await worker.drainOnce();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });
  it('ignores a claim returned after shutdown', async () => {
    const worker = create(undefined) as unknown as Worker;
    let finish!: (rows: unknown[]) => void;
    jest.spyOn(worker, 'claim').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const process = jest.spyOn(worker, method).mockResolvedValue(undefined);
    const pending = worker.drainOnce();
    worker.onModuleDestroy();
    finish([{}]);
    await pending;
    expect(process).not.toHaveBeenCalled();
  });
  it('finishes active work without starting the next item', async () => {
    const worker = create(undefined) as unknown as Worker;
    jest.spyOn(worker, 'claim').mockResolvedValue([{}, {}]);
    let finish!: () => void;
    const process = jest.spyOn(worker, method).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = worker.drainOnce();
    await Promise.resolve();
    let shutdownFinished = false;
    const shutdown = Promise.resolve(worker.onModuleDestroy()).then(() => {
      shutdownFinished = true;
    });
    await Promise.resolve();
    const finishedEarly = shutdownFinished;
    finish();
    await Promise.all([pending, shutdown]);
    expect(finishedEarly).toBe(false);
    expect(process).toHaveBeenCalledTimes(1);
  });
});
