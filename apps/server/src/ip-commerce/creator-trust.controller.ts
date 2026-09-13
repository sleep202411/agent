import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { ZodValidationPipe } from '../common/zod.pipe';
export const TrustEntriesQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
  })
  .strict();
@Controller('me/crew-trust')
export class CreatorTrustController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('entries')
  async entries(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(TrustEntriesQuery))
    query: z.infer<typeof TrustEntriesQuery>,
  ) {
    let boundary = Prisma.empty;
    if (query.cursor) {
      const [cursor] = await this.prisma.$queryRaw<
        { createdAt: Date }[]
      >`SELECT created_at AS "createdAt" FROM crew_creator_trust_entries WHERE user_id=${user.userId} AND task_id=${query.cursor}::uuid`;
      if (!cursor)
        throw new BadRequestException('Invalid trust-history cursor.');
      boundary = Prisma.sql`AND (e.created_at,e.task_id) < (SELECT created_at,task_id FROM crew_creator_trust_entries WHERE user_id=${user.userId} AND task_id=${query.cursor}::uuid)`;
    }
    const rows = await this.prisma.$queryRaw<
      {
        taskId: string;
        submissionId: string;
        points: number;
        recordedAt: Date;
        submittedAt: Date;
        deadline: string;
      }[]
    >(Prisma.sql`
      SELECT e.task_id AS "taskId", e.submission_id AS "submissionId", e.points, e.created_at AS "recordedAt",
        s.created_at AS "submittedAt", s.timeliness_result->>'deadline' AS deadline
      FROM crew_creator_trust_entries e JOIN crew_task_submissions s ON s.id=e.submission_id
      WHERE e.user_id=${user.userId} ${boundary} ORDER BY e.created_at DESC,e.task_id DESC LIMIT ${query.limit + 1}`);
    const items = rows.slice(0, query.limit);
    return {
      items,
      nextCursor:
        rows.length > query.limit ? items[items.length - 1].taskId : null,
    };
  }
  @Get()
  async read(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(z.object({}).strict()))
    _query: Record<string, never>,
  ) {
    void _query;
    const [summary] = await this.prisma.$queryRaw<
      { points: string; taskCount: string; onTime: string; late: string }[]
    >`
 SELECT COALESCE(sum(points),0)::text AS points, count(*)::text AS "taskCount",
 count(*) FILTER(WHERE points=200)::text AS "onTime", count(*) FILTER(WHERE points=-200)::text AS late
 FROM crew_creator_trust_entries WHERE user_id=${user.userId}`;
    return summary;
  }
}
