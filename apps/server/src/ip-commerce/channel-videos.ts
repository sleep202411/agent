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
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import {
  isPeerViewable,
  requireModerationApproval,
} from '../media/media-moderation-policy';
import { ZodValidationPipe } from '../common/zod.pipe';
import { IpCommerceService } from './ip-commerce.service';
import { lockMediaAssetReference } from '../media/media-asset-lifecycle-lock';

export const VideoSubmissionInput = z
  .object({
    assetId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
  })
  .strict();
const Params = z.object({ ipId: z.string().uuid() });
const Decision = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['approved', 'rejected']),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
const Page = z.object({ cursor: z.string().uuid().optional() });
type Entry = {
  id: string;
  assetId: string;
  submittedById: string;
  title: string;
  description: string;
  status: string;
  version: number;
};

@Injectable()
export class ChannelVideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
    private readonly storage: MediaStorageAccessService,
  ) {}

  async submit(
    ipId: string,
    user: AuthUser,
    input: z.infer<typeof VideoSubmissionInput>,
  ) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    return this.prisma.$transaction(async (tx) => {
      const channels = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM ips WHERE id=${ipId}::uuid AND channel_type='community' AND status='published' AND listing_visibility='public' AND deleted_at IS NULL FOR UPDATE`;
      if (!channels.length)
        throw new NotFoundException('Community channel not found.');
      const [setting] = await tx.$queryRaw<
        { open: boolean }[]
      >`SELECT open FROM ip_channel_submission_settings WHERE ip_id=${ipId}::uuid`;
      if (!setting?.open)
        throw new ConflictException(
          'This channel is not accepting submissions.',
        );
      // Validate after locking: cleanup may have retired the video while this
      // submission waited. Hold the shared lock until its reference commits.
      await lockMediaAssetReference(tx, input.assetId);
      const asset = await tx.mediaAsset.findFirst({
        where: {
          id: input.assetId,
          createdByUserId: user.userId,
          kind: 'video',
          status: 'ready',
          deletedAt: null,
          moderationStatus: { not: 'blocked' },
        },
      });
      if (!asset || asset.workspaceId || asset.source !== 'user_upload')
        throw new BadRequestException(
          'Choose a video uploaded by your account.',
        );
      const [result] = await tx.$queryRaw<
        Entry[]
      >`INSERT INTO ip_channel_video_submissions(id,channel_id,asset_id,submitted_by_id,title,description) VALUES (${randomUUID()}::uuid,${ipId}::uuid,${input.assetId}::uuid,${user.userId},${input.title},${input.description}) ON CONFLICT(channel_id,asset_id,submitted_by_id) DO UPDATE SET id=ip_channel_video_submissions.id RETURNING id,status`;
      return result;
    });
  }

  async list(ipId: string, user?: AuthUser, cursor?: string) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    const channel = await this.prisma.ip.findFirst({
      where: { id: ipId, channelType: 'community', deletedAt: null },
      select: { createdById: true },
    });
    if (!channel) return { items: [], canManage: false, nextCursor: null };
    const canManage = channel.createdById === user?.userId;
    const rows = await this.prisma.$queryRaw<
      Entry[]
    >`SELECT id,asset_id AS "assetId",submitted_by_id AS "submittedById",title,description,status,version FROM ip_channel_video_submissions WHERE channel_id=${ipId}::uuid AND (status='approved' OR ${canManage} OR submitted_by_id=${user?.userId ?? ''}) AND (${cursor ?? null}::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM ip_channel_video_submissions WHERE id=${cursor ?? null}::uuid AND channel_id=${ipId}::uuid)) ORDER BY created_at DESC,id DESC LIMIT 21`;
    const items: {
      id: string;
      title: string;
      description: string;
      status: string;
      version: number;
      url: string | null;
    }[] = [];
    for (const row of rows.slice(0, 20)) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          id: row.assetId,
          status: 'ready',
          deletedAt: null,
          moderationStatus: { not: 'blocked' },
        },
      });
      if (!asset) continue;
      // Channel review does not override regional platform media moderation.
      const playable = isPeerViewable(
        asset.moderationStatus,
        row.submittedById === user?.userId,
        requireModerationApproval(),
      );
      const access = playable
        ? await this.storage.createReadUrl(asset, {
            expiresInSeconds: 300,
            cacheControl: 'private, no-store',
          })
        : null;
      items.push({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        version: row.version,
        url: access?.url ?? null,
      });
    }
    return {
      items,
      canManage,
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }

  async decide(ipId: string, user: AuthUser, input: z.infer<typeof Decision>) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    return this.prisma.$transaction(async (tx) => {
      const owners = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM ips WHERE id=${ipId}::uuid AND channel_type='community' AND created_by_id=${user.userId} AND deleted_at IS NULL FOR UPDATE`;
      if (!owners.length)
        throw new NotFoundException('Community channel not found.');
      const changed =
        await tx.$executeRaw`UPDATE ip_channel_video_submissions SET status=${input.status},version=version+1,reviewed_by_id=${user.userId},reviewed_at=now() WHERE id=${input.id}::uuid AND channel_id=${ipId}::uuid AND status='pending' AND version=${input.expectedVersion}`;
      if (!changed)
        throw new ConflictException(
          'This submission has already changed. Refresh and try again.',
        );
      return { status: input.status };
    });
  }
}

@Controller('ip-commerce/ips/:ipId/video-submissions')
export class ChannelVideosController {
  constructor(private readonly videos: ChannelVideosService) {}
  @Public()
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser | undefined,
    @Query(new ZodValidationPipe(Page)) query: z.infer<typeof Page>,
  ) {
    return {
      code: 200,
      data: await this.videos.list(p.ipId, user, query.cursor),
    };
  }
  @Post()
  async submit(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(VideoSubmissionInput))
    input: z.infer<typeof VideoSubmissionInput>,
  ) {
    return { code: 200, data: await this.videos.submit(p.ipId, user, input) };
  }
  @Patch()
  async decide(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Decision)) input: z.infer<typeof Decision>,
  ) {
    return { code: 200, data: await this.videos.decide(p.ipId, user, input) };
  }
}
