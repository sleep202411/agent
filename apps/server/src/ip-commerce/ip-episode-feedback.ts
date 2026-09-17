import {
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import type { Prisma } from '@prisma/client';
export interface EpisodeFeedback {
  likes: number;
  dislikes: number;
  mine: number | null;
}
@Injectable()
export class IpEpisodeFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
  ) {}
  private async authorize(
    db: Prisma.TransactionClient,
    ipId: string,
    episodeId: string,
    user?: AuthUser,
  ) {
    await this.ips.ensurePublicEngagementTarget(user, ipId, db);
    const episode = await db.ipEpisode.findFirst({
      where: {
        id: episodeId,
        ipId,
        deletedAt: null,
        status: 'published',
        episodeNo: { gte: 1, lte: 3 },
      },
      select: { id: true },
    });
    if (!episode) throw new NotFoundException('Published episode not found.');
  }
  private async summary(
    db: Prisma.TransactionClient,
    episodeId: string,
    user?: AuthUser,
  ): Promise<EpisodeFeedback> {
    const [row] = await db.$queryRaw<EpisodeFeedback[]>`
      SELECT count(*) FILTER (WHERE value = 1)::int AS likes,
             count(*) FILTER (WHERE value = -1)::int AS dislikes,
             max(value) FILTER (WHERE user_id = ${user?.userId ?? null})::int AS mine
      FROM ip_episode_feedback WHERE episode_id = ${episodeId}::uuid`;
    return row;
  }
  async read(ipId: string, episodeId: string, user?: AuthUser) {
    await this.authorize(this.prisma, ipId, episodeId, user);
    return this.summary(this.prisma, episodeId, user);
  }
  async vote(
    ipId: string,
    episodeId: string,
    user: AuthUser,
    value: -1 | 1 | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ips WHERE id = ${ipId}::uuid FOR UPDATE /* episode-feedback */`;
      await tx.$queryRaw`SELECT id FROM ip_episodes WHERE id = ${episodeId}::uuid AND ip_id = ${ipId}::uuid FOR UPDATE`;
      await this.authorize(tx, ipId, episodeId, user);
      if (value === null)
        await tx.$executeRaw`DELETE FROM ip_episode_feedback WHERE episode_id = ${episodeId}::uuid AND user_id = ${user.userId}`;
      else
        await tx.$executeRaw`INSERT INTO ip_episode_feedback (episode_id, user_id, value)
        VALUES (${episodeId}::uuid, ${user.userId}, ${value})
        ON CONFLICT (episode_id, user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      return this.summary(tx, episodeId, user);
    });
  }
}
const Params = z.object({
  ipId: z.string().uuid(),
  episodeId: z.string().uuid(),
});
const Vote = z
  .object({ value: z.union([z.literal(1), z.literal(-1), z.null()]) })
  .strict();
@Controller('ip-commerce/ips/:ipId/episodes/:episodeId/feedback')
export class IpEpisodeFeedbackController {
  constructor(private readonly feedback: IpEpisodeFeedbackService) {}
  @Public()
  @Get()
  async read(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user?: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.feedback.read(params.ipId, params.episodeId, user),
    };
  }
  @Put()
  async vote(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Vote)) body: z.infer<typeof Vote>,
  ) {
    return {
      code: 200,
      data: await this.feedback.vote(
        params.ipId,
        params.episodeId,
        user,
        body.value,
      ),
    };
  }
}
