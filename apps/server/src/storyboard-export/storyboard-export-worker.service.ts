import {
  HttpException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { StoryboardExportJob } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import { StudioDocumentAccessService } from '../documents/studio-document-access.service';
import { MediaAccessService } from '../media/media-access.service';
import { StoryboardExportQueueService } from './storyboard-export-queue.service';
import { StoryboardExportOutputService } from './storyboard-export-output.service';
import { reauthorizeStoryboardJob } from './reauthorize-storyboard-job';
import { spoolStoryboard } from './spool-storyboard';
import { renderLocalStoryboard } from './local-video-renderer';

@Injectable()
export class StoryboardExportWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(StoryboardExportWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private active: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopped = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: StudioDocumentAccessService,
    private readonly media: MediaAccessService,
    private readonly storage: MediaStorageAccessService,
    private readonly queue: StoryboardExportQueueService,
    private readonly outputs: StoryboardExportOutputService,
  ) {}

  onApplicationBootstrap() {
    const run = () => {
      void this.drain().catch(() =>
        this.logger.error('Storyboard export worker cycle failed.'),
      );
    };
    this.timer = setInterval(run, 10_000);
    this.timer.unref();
    run();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort(new Error('Worker shutting down.'));
    await this.active?.catch(() => undefined);
  }
  async drain() {
    if (this.stopped) return;
    if (this.active) return this.active;
    this.active = this.cycle().finally(() => {
      this.active = null;
    });
    return this.active;
  }
  private async cycle() {
    await this.queue.sweep();
    const cleanup = await this.outputs.sweep();
    if (cleanup.failed)
      this.logger.warn('Storyboard output deletions retained for retry.');
    if (this.stopped) return;
    const job = await this.queue.claim();
    if (!job) return;
    await this.process(job);
  }
  private async process(job: StoryboardExportJob) {
    const controller = new AbortController();
    this.controller = controller;
    if (this.stopped) controller.abort(new Error('Worker shutting down.'));
    // A single worker owns at most one spool/render at a time. Bound the whole
    // attempt as well as individual network transfers and FFmpeg processes.
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30 * 60 * 1000),
    ]);
    const heartbeat = { pending: null as Promise<void> | null };
    const pulse = () => {
      if (heartbeat.pending || signal.aborted) return;
      heartbeat.pending = this.queue
        .heartbeat(job.id, job.leaseToken!)
        .then((owned) => {
          if (!owned)
            controller.abort(new Error('Export lease lost or cancelled.'));
        })
        .catch(() =>
          controller.abort(new Error('Export lease could not be renewed.')),
        )
        .finally(() => {
          heartbeat.pending = null;
        });
    };
    const timer = setInterval(pulse, 20_000);
    timer.unref();
    let inputs: Awaited<ReturnType<typeof spoolStoryboard>> | undefined;
    let rendered: Awaited<ReturnType<typeof renderLocalStoryboard>> | undefined;
    try {
      signal.throwIfAborted();
      const clips = await this.prisma.$transaction(
        (tx) => reauthorizeStoryboardJob(tx, this.documents, this.media, job),
        { timeout: 30_000 },
      );
      inputs = await spoolStoryboard(
        clips.map((clip) => clip.source),
        this.storage,
        signal,
      );
      signal.throwIfAborted();
      // Downloading may take minutes: recheck before spending render capacity.
      await this.prisma.$transaction(
        (tx) => reauthorizeStoryboardJob(tx, this.documents, this.media, job),
        { timeout: 30_000 },
      );
      rendered = await renderLocalStoryboard(
        {
          directory: inputs.directory,
          filenames: inputs.filenames,
          width: job.width,
          height: job.height,
        },
        signal,
      );
      signal.throwIfAborted();
      const output = await this.outputs.upload(job, rendered.path, signal);
      signal.throwIfAborted();
      await this.outputs.publish(job, job.leaseToken!, output);
    } catch (error) {
      // Shutdown leaves its lease to expire for another replica. Cancellation
      // and stale workers cannot overwrite a successor's status.
      if (!this.stopped)
        await this.queue.fail(
          job.id,
          job.leaseToken!,
          error instanceof HttpException
            ? error.message
            : 'Video export could not finish. Check that the shot videos play, then try again.',
        );
    } finally {
      clearInterval(timer);
      await heartbeat.pending;
      const cleanup = await Promise.allSettled([
        inputs?.dispose(),
        rendered?.dispose(),
      ]);
      if (cleanup.some((result) => result.status === 'rejected'))
        this.logger.error('Storyboard temporary file cleanup failed.');
      this.controller = null;
    }
  }
}
