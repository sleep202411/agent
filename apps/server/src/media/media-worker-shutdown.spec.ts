import { CdnPurgeWorkerService } from './cdn-purge-worker.service';
import { MediaTakedownWorkerService } from './media-takedown-worker.service';
import { MediaProcessingWorkerService } from './media-processing-worker.service';

type Worker = {
  drainOnce: () => Promise<void>;
  onModuleDestroy: () => void;
  claim: () => Promise<unknown[]>;
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
      new MediaTakedownWorkerService(db as never, undefined as never),
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
    worker.onModuleDestroy();
    finish();
    await pending;
    expect(process).toHaveBeenCalledTimes(1);
  });
});
