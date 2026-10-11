import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { AppStoryAgentService } from './app-story-agent.service';

@Injectable()
export class AppStoryAgentWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AppStoryAgentWorker.name);
  private readonly owner = `app-story:${randomUUID()}`;
  private timer: NodeJS.Timeout | undefined;
  private readonly active = new Set<Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private draining = false;
  private stopping = false;
  constructor(private readonly runs: AppStoryAgentService) {}
  onApplicationBootstrap() {
    if (!backgroundTasksEnabled()) return;
    this.timer = setInterval(() => void this.drain(), 1000);
    this.timer.unref();
    void this.drain();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.active]);
  }
  async drain() {
    if (this.stopping || this.draining || !backgroundTasksEnabled()) return;
    this.draining = true;
    try {
      while (!this.stopping && this.active.size < 3) {
        const owner = `${this.owner}:${randomUUID()}`;
        const run = await this.runs.claim(owner);
        if (!run) break;
        const controller = new AbortController();
        this.controllers.add(controller);
        const heartbeat = setInterval(() => {
          void this.runs
            .renew(run.id, owner, run.status === 'cancelling')
            .then((alive) => {
              if (!alive) controller.abort();
            })
            .catch(() => controller.abort());
        }, 8000);
        heartbeat.unref();
        const task = (async () => {
          let error: unknown;
          try {
            await this.runs.step(run, owner, controller.signal);
          } catch (caught) {
            if (!controller.signal.aborted) error = caught;
          } finally {
            clearInterval(heartbeat);
            await this.runs.finishAttempt(run, owner, error);
          }
        })()
          .catch(() =>
            this.logger.warn(
              `Could not persist production progress run=${run.id}`,
            ),
          )
          .finally(() => {
            this.active.delete(task);
            this.controllers.delete(controller);
          });
        this.active.add(task);
      }
    } catch {
      this.logger.warn('App production polling failed.');
    } finally {
      this.draining = false;
    }
  }
}
