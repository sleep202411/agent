import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification';
import { ConversationsService } from '../../conversations/conversations.service';
import { CrewAuthorizationService } from '../crew-authorization.service';

export const ExtensionRequestInput = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive().max(2147483646),
    requestedDueAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict();
export const ExtensionDecisionInput = z
  .object({
    action: z.enum(['approve', 'reject', 'withdraw']),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict();
const Page = z
  .object({
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

@Injectable()
export class CrewTaskExtensionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: CrewAuthorizationService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationsService,
  ) {}

  private async task(tx: Prisma.TransactionClient, taskId: string) {
    const task = await tx.crewTask.findFirst({
      where: { id: taskId, deletedAt: null, crew: { deletedAt: null } },
      include: { workflowState: true, assignees: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async access(
    tx: Prisma.TransactionClient,
    taskId: string,
    userId: string,
  ) {
    const task = await this.task(tx, taskId);
    const context = await this.auth.requireMembership(task.crewId, userId, tx);
    if (
      !task.assignees.some((a) => a.userId === userId) &&
      !context.permissions.includes('tasks.manage')
    )
      throw new ForbiddenException(
        'Only assigned creators and task managers can read extension requests.',
      );
    return task;
  }

  private open(task: Awaited<ReturnType<CrewTaskExtensionsService['task']>>) {
    if (
      ['approved', 'cancelled', 'submitted'].includes(
        task.workflowState.semantic,
      )
    )
      throw new ConflictException(
        'Extensions require unfinished work that is not awaiting review.',
      );
  }

  private async notify(
    tx: Prisma.TransactionClient,
    task: Awaited<ReturnType<CrewTaskExtensionsService['task']>>,
    actor: string,
    requestId: string,
    status: string,
  ) {
    const ownership = await tx.crewOwnership.findUnique({
      where: { crewId: task.crewId },
      include: { member: true },
    });
    const recipients = new Set(task.assignees.map((a) => a.userId));
    if (ownership) recipients.add(ownership.member.userId);
    recipients.delete(actor);
    for (const userId of recipients)
      await this.notifications.send(
        {
          userId,
          type: 'crew.task.updated',
          title: `Deadline extension: ${task.title}`,
          body:
            status === 'pending'
              ? 'A creator requested a deadline extension.'
              : `The deadline extension was ${status}.`,
          meta: {
            crewId: task.crewId,
            taskId: task.id,
            taskTitle: task.title,
            actorUserId: actor,
            deeplink: `/crews/${task.crewId}/workspace?tab=tasks&task=${task.id}`,
          },
          idempotencyKey: `crew.task.extension:${requestId}:${status}:${userId}`,
        },
        tx,
      );
  }

  async request(
    taskId: string,
    userId: string,
    raw: z.infer<typeof ExtensionRequestInput>,
  ) {
    const input = ExtensionRequestInput.parse(raw);
    const initial = await this.access(this.db, taskId, userId);
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${initial.crewId}`}, 0))`;
      const task = await this.access(tx, taskId, userId);
      if (!task.assignees.some((a) => a.userId === userId))
        throw new ForbiddenException(
          'Only an assigned creator can request an extension.',
        );
      const requestedDueAt = new Date(input.requestedDueAt);
      const existing = await tx.crewTaskExtensionRequest.findUnique({
        where: { id: input.requestId },
      });
      if (existing) {
        if (
          existing.taskId !== taskId ||
          existing.requesterUserId !== userId ||
          existing.taskVersion !== input.expectedVersion ||
          existing.reason !== input.reason ||
          existing.requestedDueAt.getTime() !== requestedDueAt.getTime()
        )
          throw new ConflictException(
            'The request ID was already used for another extension.',
          );
        return existing;
      }
      this.open(task);
      if (task.version !== input.expectedVersion)
        throw new ConflictException(
          'Task changed. Refresh before requesting an extension.',
        );
      if (
        !task.dueAt ||
        requestedDueAt <= task.dueAt ||
        requestedDueAt <= new Date()
      )
        throw new ConflictException(
          'Request a future deadline later than the existing deadline.',
        );
      if (
        await tx.crewTaskExtensionRequest.findFirst({
          where: { taskId, requesterUserId: userId, status: 'pending' },
        })
      )
        throw new ConflictException(
          'Resolve or withdraw your pending extension first.',
        );
      const row = await tx.crewTaskExtensionRequest.create({
        data: {
          id: input.requestId,
          taskId,
          requesterUserId: userId,
          taskVersion: task.version,
          previousDueAt: task.dueAt,
          requestedDueAt,
          reason: input.reason,
        },
      });
      await this.notify(tx, task, userId, row.id, row.status);
      await this.auth.requireMembership(task.crewId, userId, tx);
      return row;
    });
    await this.conversations.broadcastCrewTaskChange(
      initial.crewId,
      taskId,
      'updated',
      userId,
    );
    return result;
  }

  async decide(
    taskId: string,
    requestId: string,
    userId: string,
    raw: z.infer<typeof ExtensionDecisionInput>,
  ) {
    const input = ExtensionDecisionInput.parse(raw);
    const initial = await this.access(this.db, taskId, userId);
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${initial.crewId}`}, 0))`;
      const task = await this.access(tx, taskId, userId);
      const row = await tx.crewTaskExtensionRequest.findFirst({
        where: { id: requestId, taskId },
      });
      if (!row) throw new NotFoundException('Extension request not found.');
      const authorize = async () => {
        if (input.action === 'withdraw') {
          if (row.requesterUserId !== userId)
            throw new ForbiddenException('Only the requester can withdraw.');
          await this.auth.requireMembership(task.crewId, userId, tx);
        } else {
          if (row.requesterUserId === userId)
            throw new ForbiddenException(
              'You cannot review your own extension request.',
            );
          await this.auth.require(task.crewId, userId, 'tasks.manage', tx);
        }
      };
      await authorize();
      const status = {
        approve: 'approved',
        reject: 'rejected',
        withdraw: 'withdrawn',
      }[input.action];
      if (row.status !== 'pending') {
        if (
          row.status === status &&
          row.decidedByUserId === userId &&
          row.decisionReason === input.reason
        )
          return row;
        throw new ConflictException(
          'This extension already has a final decision.',
        );
      }
      if (input.action === 'approve') {
        this.open(task);
        if (
          task.version !== row.taskVersion ||
          task.dueAt?.getTime() !== row.previousDueAt.getTime()
        )
          throw new ConflictException(
            'Task changed since this request. Reject it and request the extension again.',
          );
        if (
          row.requestedDueAt <= new Date() ||
          (task.startAt && row.requestedDueAt < task.startAt)
        )
          throw new ConflictException(
            'The requested deadline is no longer valid.',
          );
        if (!task.assignees.some((a) => a.userId === row.requesterUserId))
          throw new ConflictException('The requester is no longer assigned.');
        await this.auth.requireMembership(task.crewId, row.requesterUserId, tx);
        await tx.crewTask.update({
          where: { id: taskId },
          data: { dueAt: row.requestedDueAt, version: { increment: 1 } },
        });
        await tx.crewTaskTimelineItem.create({
          data: {
            taskId,
            kind: 'task.updated',
            actorUserId: userId,
            payload: {
              extensionRequestId: row.id,
              changedFields: {
                dueAt: {
                  from: row.previousDueAt.toISOString(),
                  to: row.requestedDueAt.toISOString(),
                },
              },
            },
          },
        });
      }
      const updated = await tx.crewTaskExtensionRequest.update({
        where: { id: row.id },
        data: {
          status,
          decidedByUserId: userId,
          decisionReason: input.reason,
          decidedAt: new Date(),
        },
      });
      await this.notify(tx, task, userId, row.id, status);
      await authorize();
      if (input.action === 'approve')
        await this.auth.requireMembership(task.crewId, row.requesterUserId, tx);
      return updated;
    });
    await this.conversations.broadcastCrewTaskChange(
      initial.crewId,
      taskId,
      'updated',
      userId,
    );
    return result;
  }

  async list(
    taskId: string,
    userId: string,
    raw: z.infer<typeof Page> = { limit: 20 },
  ) {
    const page = Page.parse(raw);
    await this.access(this.db, taskId, userId);
    const cursor = page.beforeId
      ? await this.db.crewTaskExtensionRequest.findFirst({
          where: { id: page.beforeId, taskId },
        })
      : null;
    if (page.beforeId && !cursor)
      throw new NotFoundException('Extension cursor not found.');
    const rows = await this.db.crewTaskExtensionRequest.findMany({
      where: {
        taskId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });
    return {
      items: rows.slice(0, page.limit),
      nextBeforeId: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  }
}

@Controller('crew-tasks/:taskId/extensions')
export class CrewTaskExtensionsController {
  constructor(private readonly svc: CrewTaskExtensionsService) {}
  @Get()
  list(
    @Param('taskId') id: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(Page)) page: z.infer<typeof Page>,
  ) {
    return this.svc.list(parseIdParam(id, 'taskId'), user.userId, page);
  }
  @Post()
  request(
    @Param('taskId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ExtensionRequestInput))
    input: z.infer<typeof ExtensionRequestInput>,
  ) {
    return this.svc.request(parseIdParam(id, 'taskId'), user.userId, input);
  }
  @Post(':requestId/decision')
  decide(
    @Param('taskId') id: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ExtensionDecisionInput))
    input: z.infer<typeof ExtensionDecisionInput>,
  ) {
    return this.svc.decide(
      parseIdParam(id, 'taskId'),
      parseIdParam(requestId, 'requestId'),
      user.userId,
      input,
    );
  }
}
