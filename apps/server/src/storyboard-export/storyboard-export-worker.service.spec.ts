import type { StoryboardExportJob } from '@prisma/client';
import { StoryboardExportWorkerService } from './storyboard-export-worker.service';
import { reauthorizeStoryboardJob } from './reauthorize-storyboard-job';
import { spoolStoryboard } from './spool-storyboard';
import { renderLocalStoryboard } from './local-video-renderer';
jest.mock('./reauthorize-storyboard-job', () => ({
  reauthorizeStoryboardJob: jest.fn(),
}));
jest.mock('./spool-storyboard', () => ({ spoolStoryboard: jest.fn() }));
jest.mock('./local-video-renderer', () => ({
  renderLocalStoryboard: jest.fn(),
}));
const authorize = jest.mocked(reauthorizeStoryboardJob);
const spool = jest.mocked(spoolStoryboard);
const render = jest.mocked(renderLocalStoryboard);
describe('storyboard export worker', () => {
  const job = {
    id: 'job',
    leaseToken: 'lease',
    width: 1280,
    height: 720,
  } as StoryboardExportJob;
  function fixture() {
    const prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
    };
    const queue = {
      sweep: jest.fn().mockResolvedValue(0),
      claim: jest.fn().mockResolvedValueOnce(job).mockResolvedValue(null),
      heartbeat: jest.fn().mockResolvedValue(true),
      fail: jest.fn().mockResolvedValue(true),
    };
    const outputs = {
      sweep: jest.fn().mockResolvedValue({ failed: 0 }),
      upload: jest.fn().mockResolvedValue({ key: 'private', sizeBytes: 3 }),
      publish: jest.fn().mockResolvedValue(true),
    };
    const inputs = {
      directory: '/tmp/owned',
      filenames: ['input-0.mp4'],
      dispose: jest.fn().mockResolvedValue(undefined),
    };
    const rendered = {
      path: '/tmp/rendered.mp4',
      sizeBytes: 3,
      durationMs: 1000,
      dispose: jest.fn().mockResolvedValue(undefined),
    };
    authorize.mockResolvedValue([
      { shotId: 'shot', sourceNodeId: 'source', source: { assetId: 'asset' } },
    ] as never);
    spool.mockResolvedValue(inputs);
    render.mockResolvedValue(rendered);
    const worker = new StoryboardExportWorkerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      queue as never,
      outputs as never,
    );
    return { worker, queue, outputs, inputs, rendered };
  }
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());
  it('authorizes before download and render, publishes once and disposes both spools', async () => {
    const t = fixture();
    await t.worker.drain();
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledWith(
      {
        directory: t.inputs.directory,
        filenames: t.inputs.filenames,
        width: 1280,
        height: 720,
      },
      expect.any(AbortSignal),
    );
    expect(t.outputs.publish).toHaveBeenCalledWith(job, 'lease', {
      key: 'private',
      sizeBytes: 3,
    });
    expect(t.queue.fail).not.toHaveBeenCalled();
    expect(t.inputs.dispose).toHaveBeenCalledTimes(1);
    expect(t.rendered.dispose).toHaveBeenCalledTimes(1);
  });
  it('cleans files and fails only its own lease after publication rejection', async () => {
    const t = fixture();
    t.outputs.publish.mockRejectedValue(new Error('internal details'));
    await t.worker.drain();
    expect(t.queue.fail).toHaveBeenCalledWith(
      'job',
      'lease',
      expect.not.stringContaining('internal details'),
    );
    expect(t.inputs.dispose).toHaveBeenCalled();
    expect(t.rendered.dispose).toHaveBeenCalled();
  });
  it('never downloads if initial authorization fails', async () => {
    const t = fixture();
    authorize.mockRejectedValueOnce(new Error('access revoked'));
    await t.worker.drain();
    expect(spool).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(t.outputs.upload).not.toHaveBeenCalled();
  });
  it('aborts downloads after lease loss and prevents concurrent cycles', async () => {
    jest.useFakeTimers();
    const t = fixture();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    spool.mockImplementation(
      (_sources, _storage, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
          started();
        }),
    );
    t.queue.heartbeat.mockResolvedValue(false);
    const first = t.worker.drain();
    await ready;
    const second = t.worker.drain();
    await jest.advanceTimersByTimeAsync(20_000);
    await Promise.all([first, second]);
    expect(t.queue.claim).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    expect(t.outputs.publish).not.toHaveBeenCalled();
  });
  it('shutdown aborts active work but leaves the job retryable by another worker', async () => {
    const t = fixture();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    spool.mockImplementation(
      (_sources, _storage, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
          started();
        }),
    );
    const running = t.worker.drain();
    await ready;
    await t.worker.onModuleDestroy();
    await running;
    expect(t.queue.fail).not.toHaveBeenCalled();
    await t.worker.drain();
    expect(t.queue.claim).toHaveBeenCalledTimes(1);
  });
});
