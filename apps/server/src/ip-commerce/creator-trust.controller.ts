import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { ZodValidationPipe } from '../common/zod.pipe';
@Controller('me/crew-trust')
export class CreatorTrustController {
  constructor(private readonly prisma: PrismaService) {}
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
