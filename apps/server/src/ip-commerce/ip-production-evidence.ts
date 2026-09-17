import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  RequireAdminPermissions,
} from '../admin-auth';

export interface IpProductionEvidence {
  ipId: string;
  publicationStatus: string;
  humanIpLikes: string;
  episodes: {
    episodeId: string;
    episodeNo: number;
    likes: string;
    dislikes: string;
  }[];
}

// One statement keeps the IP and episode totals on the same database snapshot.
// These are explicit IP likes, not inferred Crew fans or automatic eligibility.
export async function readIpProductionEvidence(
  db: Prisma.TransactionClient,
  ipId: string,
): Promise<IpProductionEvidence> {
  const [evidence] = await db.$queryRaw<IpProductionEvidence[]>`
    SELECT ip.id AS "ipId", ip.status::text AS "publicationStatus",
      (SELECT count(*)::text FROM ip_likes l WHERE l.ip_id=ip.id
       AND l.actor_kind='human' AND l.status='active' AND l.removed_at IS NULL) AS "humanIpLikes",
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'episodeId', e.id, 'episodeNo', e.episode_no,
        'likes', (SELECT count(*)::text FROM ip_episode_feedback f WHERE f.episode_id=e.id AND f.value=1),
        'dislikes', (SELECT count(*)::text FROM ip_episode_feedback f WHERE f.episode_id=e.id AND f.value=-1)
      ) ORDER BY e.episode_no) FROM ip_episodes e WHERE e.ip_id=ip.id
        AND e.episode_no BETWEEN 1 AND 3 AND e.status='published' AND e.deleted_at IS NULL), '[]'::jsonb) AS episodes
    FROM ips ip WHERE ip.id=${ipId}::uuid AND ip.deleted_at IS NULL`;
  if (!evidence) throw new NotFoundException('IP not found.');
  return evidence;
}

@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/ip-commerce/ips/:ipId/production-evidence')
export class IpProductionEvidenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  async read(
    @Param(new ZodValidationPipe(z.object({ ipId: z.string().uuid() })))
    params: {
      ipId: string;
    },
  ) {
    return {
      code: 200,
      data: await readIpProductionEvidence(this.prisma, params.ipId),
    };
  }
}
