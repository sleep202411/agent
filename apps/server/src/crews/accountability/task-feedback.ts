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
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CurrentUser, type AuthUser } from '../../auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';

const score = z.number().int().min(1).max(5);
export const TaskFeedbackInput = z
  .object({
    subjectUserId: z.string().trim().min(1).max(64),
    ratings: z.discriminatedUnion('direction', [
      z
        .object({
          direction: z.literal('creator'),
          productionAbility: score,
          understanding: score,
          communication: score,
        })
        .strict(),
      z
        .object({ direction: z.literal('manager'), managementAbility: score })
        .strict(),
    ]),
    comment: z.string().trim().min(3).max(2000),
  })
  .strict();
const ResponseInput = z
  .object({ response: z.string().trim().min(3).max(2000) })
  .strict();
const TaskParam = z.object({ taskId: z.string().uuid() });
const FeedbackParam = z.object({ id: z.string().uuid() });
export const TaskFeedbackPageInput = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

@Injectable()
export class CrewTaskFeedbackService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: CrewAuthorizationService,
  ) {}

  async submit(
    taskId: string,
    userId: string,
    raw: z.infer<typeof TaskFeedbackInput>,
  ) {
    const input = TaskFeedbackInput.parse(raw);
    if (userId === input.subjectUserId)
      throw new ForbiddenException('Self-reviews are not allowed.');
    const task = await this.db.crewTask.findFirst({
      where: { id: taskId, deletedAt: null },
      select: { crewId: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${task.crewId}`}, 0))`;
      await this.auth.require(task.crewId, userId, 'tasks.view', tx);
      const current = await tx.crewTask.findFirst({
        where: { id: taskId, deletedAt: null },
        include: {
          workflowState: true,
          submissions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        },
      });
      if (!current || current.workflowState.semantic !== 'approved')
        throw new ConflictException('Feedback requires an approved task.');
      const submission = current.submissions[0];
      if (!submission?.reviewedAt || !submission.reviewedByUserId)
        throw new ConflictException(
          'The approved submission has no review evidence.',
        );
      const direction =
        userId === submission.reviewedByUserId &&
        input.subjectUserId === submission.submittedByUserId
          ? 'creator'
          : userId === submission.submittedByUserId &&
              input.subjectUserId === submission.reviewedByUserId
            ? 'manager'
            : null;
      if (!direction || direction !== input.ratings.direction)
        throw new ForbiddenException(
          'Only the approved submitter and actual reviewer may evaluate each other.',
        );
      const existing = await tx.crewTaskFeedback.findUnique({
        where: {
          taskId_authorUserId_subjectUserId: {
            taskId,
            authorUserId: userId,
            subjectUserId: input.subjectUserId,
          },
        },
      });
      if (existing) {
        const stored = TaskFeedbackInput.parse({
          subjectUserId: existing.subjectUserId,
          ratings: existing.ratings,
          comment: existing.comment,
        });
        if (JSON.stringify(stored) !== JSON.stringify(input))
          throw new ConflictException(
            'Feedback was already submitted with different ratings or comments.',
          );
        return existing;
      }
      const feedback = await tx.crewTaskFeedback.create({
        data: {
          id: randomUUID(),
          taskId,
          submissionId: submission.id,
          authorUserId: userId,
          subjectUserId: input.subjectUserId,
          direction,
          ratings: input.ratings,
          comment: input.comment,
        },
      });
      await this.auth.require(task.crewId, userId, 'tasks.view', tx);
      return feedback;
    });
  }

  async list(
    taskId: string,
    userId: string,
    query: z.infer<typeof TaskFeedbackPageInput>,
  ) {
    const task = await this.db.crewTask.findFirst({
      where: { id: taskId, deletedAt: null },
      select: { crewId: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    await this.auth.require(task.crewId, userId, 'tasks.view');
    return this.readHistory(userId, query, taskId);
  }

  // Participation in feedback survives departure without restoring task access.
  async listMine(userId: string, query: z.infer<typeof TaskFeedbackPageInput>) {
    return this.readHistory(userId, query);
  }

  private async readHistory(
    userId: string,
    query: z.infer<typeof TaskFeedbackPageInput>,
    taskId?: string,
  ) {
    const where: Prisma.CrewTaskFeedbackWhereInput = {
      ...(taskId ? { taskId } : {}),
      OR: [{ authorUserId: userId }, { subjectUserId: userId }],
    };
    if (
      query.cursor &&
      !(await this.db.crewTaskFeedback.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      }))
    )
      throw new NotFoundException(
        'Feedback cursor not found for this history.',
      );
    const rows = await this.db.crewTaskFeedback.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    };
  }

  async respond(
    id: string,
    userId: string,
    raw: z.infer<typeof ResponseInput>,
  ) {
    const { response } = ResponseInput.parse(raw);
    // A former member retains the right to respond to feedback about their own work.
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-feedback:${id}`}, 0))`;
      const feedback = await tx.crewTaskFeedback.findFirst({
        where: { id, subjectUserId: userId },
      });
      if (!feedback) throw new NotFoundException('Feedback not found.');
      if (feedback.response !== null) {
        if (feedback.response !== response)
          throw new ConflictException('A response has already been recorded.');
        return feedback;
      }
      return tx.crewTaskFeedback.update({
        where: { id },
        data: { response, respondedAt: new Date() },
      });
    });
  }
}

@Controller()
export class CrewTaskFeedbackController {
  constructor(private readonly feedback: CrewTaskFeedbackService) {}
  @Get('me/crew-task-feedback')
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(TaskFeedbackPageInput))
    query: z.infer<typeof TaskFeedbackPageInput>,
  ) {
    return this.feedback.listMine(user.userId, query);
  }
  @Post('crew-tasks/:taskId/feedback')
  submit(
    @Param(new ZodValidationPipe(TaskParam)) params: z.infer<typeof TaskParam>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(TaskFeedbackInput))
    input: z.infer<typeof TaskFeedbackInput>,
  ) {
    return this.feedback.submit(params.taskId, user.userId, input);
  }
  @Get('crew-tasks/:taskId/feedback')
  list(
    @Param(new ZodValidationPipe(TaskParam)) params: z.infer<typeof TaskParam>,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(TaskFeedbackPageInput))
    query: z.infer<typeof TaskFeedbackPageInput>,
  ) {
    return this.feedback.list(params.taskId, user.userId, query);
  }
  @Put('crew-task-feedback/:id/response')
  respond(
    @Param(new ZodValidationPipe(FeedbackParam))
    params: z.infer<typeof FeedbackParam>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ResponseInput))
    input: z.infer<typeof ResponseInput>,
  ) {
    return this.feedback.respond(params.id, user.userId, input);
  }
}
