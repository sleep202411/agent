import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';
const submitSchema = z
  .object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(2000) })
  .strict();
const reviewSchema = z
  .object({
    decision: z.enum(['upheld', 'corrected']),
    points: z.union([z.literal(200), z.literal(-200)]).optional(),
    reason: z.string().trim().min(1).max(2000),
    expectedCorrectionId: z.string().uuid().nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.decision === 'corrected'
        ? v.points !== undefined
        : v.points === undefined,
    'Only corrections specify points',
  );
const pageSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    status: z.enum(['pending', 'all']).default('pending'),
  })
  .strict();
type Entry = {
  taskId: string;
  submissionId: string;
  userId: string;
  crewId: string;
  points: number;
};
type Appeal = {
  id: string;
  taskId: string;
  userId: string;
  reason: string;
  status: string;
  correctionId: string | null;
  reviewerId?: string | null;
  reviewReason?: string | null;
};
@Injectable()
export class CrewTrustAppealService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: CrewAuthorizationService,
  ) {}
  private async entry(
    tx: Prisma.TransactionClient,
    taskId: string,
    userId: string,
  ) {
    const [entry] = await tx.$queryRaw<
      Entry[]
    >`SELECT e.task_id AS "taskId",e.submission_id AS "submissionId",e.user_id AS "userId",e.points,t.crew_id AS "crewId" FROM crew_creator_trust_entries e JOIN crew_tasks t ON t.id=e.task_id WHERE e.task_id=${taskId}::uuid AND e.user_id=${userId}`;
    if (!entry) throw new NotFoundException('Trust entry not found');
    return entry;
  }
  async submit(
    taskId: string,
    userId: string,
    input: z.infer<typeof submitSchema>,
  ) {
    input = submitSchema.parse(input);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trust-appeal-id:${input.id}`},0))`;
      await this.entry(tx, taskId, userId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trust-appeal:${taskId}:${userId}`},0))`;
      const [existing] = await tx.$queryRaw<
        Appeal[]
      >`SELECT id,task_id AS "taskId",user_id AS "userId",reason,status FROM crew_trust_appeals WHERE id=${input.id}::uuid`;
      if (existing) {
        if (
          existing.taskId !== taskId ||
          existing.userId !== userId ||
          existing.reason !== input.reason
        )
          throw new ConflictException(
            'Appeal retry does not match its original request',
          );
        return existing;
      }
      const [pending] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM crew_trust_appeals WHERE task_id=${taskId}::uuid AND user_id=${userId} AND status='pending'`;
      if (pending)
        throw new ConflictException('A trust appeal is already pending');
      const [result] = await tx.$queryRaw<
        Appeal[]
      >`INSERT INTO crew_trust_appeals(id,task_id,user_id,reason) VALUES(${input.id}::uuid,${taskId}::uuid,${userId},${input.reason}) RETURNING id,task_id AS "taskId",user_id AS "userId",reason,status`;
      return result;
    });
  }
  async list(
    userId: string,
    scope: { taskId: string } | { crewId: string; history?: boolean },
    cursor?: string,
  ) {
    if ('crewId' in scope)
      await this.auth.require(scope.crewId, userId, 'tasks.manage');
    else await this.entry(this.db, scope.taskId, userId);
    const filter =
      'crewId' in scope
        ? Prisma.sql`t.crew_id=${scope.crewId} ${scope.history ? Prisma.empty : Prisma.sql`AND a.status='pending'`}`
        : Prisma.sql`a.task_id=${scope.taskId}::uuid AND a.user_id=${userId}`;
    if (cursor) {
      const rows = await this.db.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT a.id FROM crew_trust_appeals a JOIN crew_tasks t ON t.id=a.task_id WHERE ${filter} AND a.id=${cursor}::uuid`,
      );
      if (!rows.length) throw new BadRequestException('Invalid appeal cursor');
    }
    const rows = await this.db.$queryRaw<
      (Appeal & { currentCorrectionId: string | null })[]
    >(Prisma.sql`
   SELECT a.id,a.task_id AS "taskId",a.user_id AS "userId",a.reason,a.status,a.review_reason AS "reviewReason",a.reviewer_id AS "reviewerId",a.reviewed_at AS "reviewedAt",a.created_at AS "createdAt",a.correction_id AS "correctionId",
   e.submission_id AS "submissionId",e.points AS "originalPoints",COALESCE(c.points,e.points) AS points,c.id AS "currentCorrectionId",s.created_at AS "submittedAt",s.timeliness_result->>'deadline' AS deadline
   FROM crew_trust_appeals a JOIN crew_tasks t ON t.id=a.task_id JOIN crew_creator_trust_entries e ON e.task_id=a.task_id AND e.user_id=a.user_id JOIN crew_task_submissions s ON s.id=e.submission_id
   LEFT JOIN LATERAL (SELECT id,points FROM crew_trust_corrections WHERE submission_id=e.submission_id ORDER BY revision DESC LIMIT 1) c ON true
   WHERE ${filter} ${cursor ? Prisma.sql`AND (a.created_at,a.id)<(SELECT created_at,id FROM crew_trust_appeals WHERE id=${cursor}::uuid)` : Prisma.empty} ORDER BY a.created_at DESC,a.id DESC LIMIT 21`);
    return {
      items: rows.slice(0, 20),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  async review(
    crewId: string,
    id: string,
    userId: string,
    input: z.infer<typeof reviewSchema>,
  ) {
    input = reviewSchema.parse(input);
    await this.auth.require(crewId, userId, 'tasks.manage');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`},0))`;
      await this.auth.require(crewId, userId, 'tasks.manage', tx);
      const [appeal] = await tx.$queryRaw<
        Appeal[]
      >`SELECT a.id,a.task_id AS "taskId",a.user_id AS "userId",a.reason,a.status,a.correction_id AS "correctionId",a.reviewer_id AS "reviewerId",a.review_reason AS "reviewReason" FROM crew_trust_appeals a JOIN crew_tasks t ON t.id=a.task_id WHERE a.id=${id}::uuid AND t.crew_id=${crewId} FOR UPDATE OF a`;
      if (!appeal) throw new NotFoundException('Trust appeal not found');
      if (appeal.status !== 'pending') {
        const [correction] = appeal.correctionId
          ? await tx.$queryRaw<
              { points: number }[]
            >`SELECT points FROM crew_trust_corrections WHERE id=${appeal.correctionId}::uuid`
          : [];
        if (
          appeal.status === input.decision &&
          appeal.reviewerId === userId &&
          appeal.reviewReason === input.reason &&
          correction?.points === input.points
        ) {
          await this.auth.require(crewId, userId, 'tasks.manage', tx);
          return {
            id,
            status: appeal.status,
            correctionId: appeal.correctionId,
          };
        }
        throw new ConflictException('This appeal has already been reviewed');
      }
      const entry = await this.entry(tx, appeal.taskId, appeal.userId);
      await this.auth.require(crewId, userId, 'tasks.manage', tx);
      const [current] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM crew_trust_corrections WHERE submission_id=${entry.submissionId}::uuid ORDER BY revision DESC LIMIT 1`;
      if ((current?.id ?? null) !== input.expectedCorrectionId)
        throw new ConflictException(
          'Trust evidence changed. Refresh before reviewing.',
        );
      let correctionId: string | null = null;
      if (input.decision === 'corrected') {
        correctionId = randomUUID();
        await tx.$executeRaw`INSERT INTO crew_trust_corrections(id,submission_id,points,reviewer_id,reason) VALUES(${correctionId}::uuid,${entry.submissionId}::uuid,${input.points!},${userId},${input.reason})`;
      }
      await tx.$executeRaw`UPDATE crew_trust_appeals SET status=${input.decision},reviewer_id=${userId},review_reason=${input.reason},correction_id=${correctionId}::uuid,reviewed_at=clock_timestamp() WHERE id=${id}::uuid`;
      await this.auth.require(crewId, userId, 'tasks.manage', tx);
      return { id, status: input.decision, correctionId };
    });
  }
}
@Controller()
export class CrewTrustAppealController {
  constructor(private readonly service: CrewTrustAppealService) {}
  @Post('me/crew-trust/:taskId/appeals')
  @Header('Cache-Control', 'private, no-store')
  submit(
    @CurrentUser() u: AuthUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(new ZodValidationPipe(submitSchema))
    body: z.infer<typeof submitSchema>,
  ) {
    return this.service.submit(taskId, u.userId, body);
  }
  @Get('me/crew-trust/:taskId/appeals')
  @Header('Cache-Control', 'private, no-store')
  own(
    @CurrentUser() u: AuthUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query(new ZodValidationPipe(pageSchema)) q: z.infer<typeof pageSchema>,
  ) {
    return this.service.list(u.userId, { taskId }, q.cursor);
  }
  @Get('crews/:crewId/trust-appeals')
  @Header('Cache-Control', 'private, no-store')
  queue(
    @CurrentUser() u: AuthUser,
    @Param('crewId', ParseUUIDPipe) crewId: string,
    @Query(new ZodValidationPipe(pageSchema)) q: z.infer<typeof pageSchema>,
  ) {
    return this.service.list(
      u.userId,
      { crewId, history: q.status === 'all' },
      q.cursor,
    );
  }
  @Post('crews/:crewId/trust-appeals/:id/review')
  review(
    @CurrentUser() u: AuthUser,
    @Param('crewId', ParseUUIDPipe) crewId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reviewSchema))
    body: z.infer<typeof reviewSchema>,
  ) {
    return this.service.review(crewId, id, u.userId, body);
  }
}
