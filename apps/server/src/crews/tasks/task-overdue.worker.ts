import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../infra/db/db.module';
import { backgroundTasksEnabled } from '../../common/background-tasks';
import { NotificationService } from '../../notification';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { taskReminderPredicate } from './task-deadline';

/** Existing notification/outbox uniqueness makes concurrent replicas and restarts safe. */
@Injectable()
export class CrewTaskOverdueWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CrewTaskOverdueWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;
  private cursor: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly authorization: CrewAuthorizationService,
  ) {}

  onApplicationBootstrap() {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => this.schedule(), 60_000);
    this.timer.unref?.();
    this.schedule();
  }

  private schedule() {
    void this.drainOnce().catch((error: unknown) => {
      this.logger.error(
        `Task overdue sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining?.catch(() => undefined);
  }

  async drainOnce(now = new Date()): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped) return;
    if (this.draining) return this.draining;
    this.draining = this.drain(now).finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(now: Date) {
    // A keyset page each minute bounds work and progresses past already-notified tasks.
    // Reset after reaching the end so new deadlines/assignments are picked up next cycle.
    const candidates = await this.prisma.crewTask.findMany({
      where: {
        deletedAt: null,
        crew: { deletedAt: null },
        ...taskReminderPredicate(now),
        ...(this.cursor ? { id: { gt: this.cursor } } : {}),
        assignees: { some: { crewMember: { status: 'active' } } },
      },
      select: { id: true, crewId: true },
      orderBy: { id: 'asc' },
      take: 50,
    });
    let firstError: Error | undefined;
    for (const candidate of candidates) {
      if (this.stopped) return;
      try {
        await this.prisma.$transaction(async (tx) => {
          // Same lock as assignment, submission, review and deadline changes.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${candidate.crewId}`}, 0))`;
          await tx.$queryRaw`SELECT id FROM crews WHERE id = ${candidate.crewId} FOR SHARE`;
          const task = await tx.crewTask.findFirst({
            where: {
              id: candidate.id,
              deletedAt: null,
              crew: { deletedAt: null },
              ...taskReminderPredicate(now),
            },
            select: {
              id: true,
              crewId: true,
              title: true,
              dueAt: true,
              assignees: { select: { userId: true, crewMemberId: true } },
            },
          });
          if (!task?.dueAt) return;
          const overdue = task.dueAt.getTime() < now.getTime();
          const reminderKind = overdue ? 'overdue' : 'due-soon-72h';
          for (const assignee of task.assignees) {
            // A departed or suspended creator must not receive new private task content.
            await tx.$queryRaw`SELECT id FROM crew_members WHERE id = ${assignee.crewMemberId} FOR SHARE`;
            const context = await this.authorization.resolve(
              task.crewId,
              assignee.userId,
              tx,
            );
            if (!context?.permissions.includes('tasks.view')) continue;
            await this.notifications.send(
              {
                userId: assignee.userId,
                type: 'crew.task.updated',
                title: `${overdue ? 'Task overdue' : 'Task due within 72 hours'}: ${task.title}`,
                body: `The task deadline ${overdue ? 'was' : 'is'} ${task.dueAt.toISOString()}. Review the task and its deadline with your project lead.`,
                meta: {
                  crewId: task.crewId,
                  taskId: task.id,
                  taskTitle: task.title,
                  deeplink: `/crews/${task.crewId}/workspace?tab=tasks&task=${task.id}`,
                },
                idempotencyKey: `crew.task.${reminderKind}:${task.id}:${task.dueAt.toISOString()}`,
              },
              tx,
            );
          }
        });
      } catch (error) {
        firstError ??=
          error instanceof Error ? error : new Error(String(error));
      }
      // Advance past failures too; retry next sweep without starving later tasks.
      this.cursor = candidate.id;
    }
    if (candidates.length < 50) this.cursor = undefined;
    if (firstError) throw firstError;
  }
}
