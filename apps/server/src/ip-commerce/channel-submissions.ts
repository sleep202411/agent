import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { IpCommerceService } from './ip-commerce.service';

const Params = z.object({ ipId: z.string().uuid() });
const Work = z.object({ workId: z.string().uuid() }).strict();
const Setting = z.object({ open: z.boolean() }).strict();
export const ChannelSubmissionDecision = z
  .object({
    workId: z.string().uuid(),
    status: z.enum(['approved', 'rejected']),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
type Submission = {
  id: string;
  workId: string;
  status: string;
  version: number;
};

@Injectable()
export class ChannelSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
  ) {}

  async list(
    ipId: string,
    user?: AuthUser,
    locale?: string,
    cursor?: string,
    admin = false,
  ) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    const channel = await this.prisma.ip.findFirst({
      where: { id: ipId, deletedAt: null, channelType: 'community' },
      select: { createdById: true },
    });
    if (!channel)
      return { community: false, open: false, canManage: false, items: [] };
    const canManage = admin || channel.createdById === user?.userId;
    const [settings] = await this.prisma.$queryRaw<
      { open: boolean }[]
    >`SELECT open FROM ip_channel_submission_settings WHERE ip_id = ${ipId}::uuid`;
    const rows = await this.prisma.$queryRaw<Submission[]>`
      SELECT s.id, s.work_id AS "workId", s.status, s.version FROM ip_channel_submissions s
      JOIN ips w ON w.id=s.work_id
      WHERE s.channel_id=${ipId}::uuid AND w.deleted_at IS NULL AND w.status='published' AND w.listing_visibility='public'
      AND (s.status='approved' OR ${canManage} OR s.submitted_by_id=${user?.userId ?? ''})
      AND (${cursor ?? null}::uuid IS NULL OR (s.created_at,s.id) < (SELECT created_at,id FROM ip_channel_submissions WHERE id=${cursor ?? null}::uuid AND channel_id=${ipId}::uuid))
      ORDER BY s.created_at DESC, s.id DESC LIMIT 21`;
    const items: (Submission & { title: string; roomNumber: string })[] = [];
    for (const row of rows.slice(0, 20)) {
      try {
        const { ip } = await this.ips.getPublicIp(row.workId, user, { locale });
        items.push({ ...row, title: ip.title, roomNumber: ip.roomNumber });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return {
      community: true,
      open: settings?.open ?? false,
      canManage,
      items,
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }

  async setOpen(ipId: string, user: AuthUser, open: boolean, admin = false) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM ips WHERE id=${ipId}::uuid AND (created_by_id=${user.userId} OR ${admin}) AND channel_type='community' AND deleted_at IS NULL FOR UPDATE`;
      if (!rows.length)
        throw new NotFoundException('Community channel not found.');
      await tx.$executeRaw`INSERT INTO ip_channel_submission_settings(ip_id,open,updated_by_id) VALUES (${ipId}::uuid,${open},${user.userId}) ON CONFLICT(ip_id) DO UPDATE SET open=EXCLUDED.open, updated_by_id=EXCLUDED.updated_by_id, updated_at=now()`;
      return { open };
    });
  }

  async submit(ipId: string, user: AuthUser, workId: string) {
    if (ipId === workId)
      throw new BadRequestException('A channel cannot submit itself.');
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    await this.ips.ensurePublicEngagementTarget(user, workId);
    return this.prisma.$transaction(async (tx) => {
      // Same row lock as open/close: a closed channel cannot admit a racing submission.
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
      const works = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM ips WHERE id=${workId}::uuid AND created_by_id=${user.userId} AND status='published' AND listing_visibility='public' AND deleted_at IS NULL FOR SHARE`;
      if (!works.length)
        throw new BadRequestException(
          'Choose one of your published public works.',
        );
      const count =
        await tx.$executeRaw`INSERT INTO ip_channel_submissions(id,channel_id,work_id,submitted_by_id) VALUES (${randomUUID()}::uuid,${ipId}::uuid,${workId}::uuid,${user.userId}) ON CONFLICT(channel_id,work_id) DO NOTHING`;
      if (!count)
        throw new ConflictException('This work has already been submitted.');
      return { status: 'pending' };
    });
  }

  async decide(
    ipId: string,
    user: AuthUser,
    input: z.infer<typeof ChannelSubmissionDecision>,
    admin = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const channels = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM ips WHERE id=${ipId}::uuid AND (created_by_id=${user.userId} OR ${admin}) AND channel_type='community' AND deleted_at IS NULL FOR UPDATE`;
      if (!channels.length)
        throw new NotFoundException('Community channel not found.');
      if (input.status === 'approved') {
        const works = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM ips WHERE id=${input.workId}::uuid AND status='published' AND listing_visibility='public' AND deleted_at IS NULL FOR SHARE`;
        if (!works.length)
          throw new ConflictException(
            'This work is no longer publicly published.',
          );
      }
      const count =
        await tx.$executeRaw`UPDATE ip_channel_submissions SET status=${input.status},reviewed_by_id=${user.userId},reviewed_at=now(),version=version+1 WHERE channel_id=${ipId}::uuid AND work_id=${input.workId}::uuid AND version=${input.expectedVersion} AND status='pending'`;
      if (!count)
        throw new ConflictException(
          'Submission changed. Refresh before reviewing.',
        );
      return { status: input.status };
    });
  }
}

@Controller('ip-commerce/ips/:ipId/submissions')
export class ChannelSubmissionsController {
  constructor(private readonly service: ChannelSubmissionsService) {}
  @Public()
  @Get()
  async list(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser | undefined,
    @Query(
      new ZodValidationPipe(
        z.object({
          locale: z.string().max(16).optional(),
          cursor: z.string().uuid().optional(),
        }),
      ),
    )
    query: { locale?: string; cursor?: string },
  ) {
    return {
      code: 200,
      data: await this.service.list(p.ipId, user, query.locale, query.cursor),
    };
  }
  @Patch('settings')
  async settings(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Setting)) body: z.infer<typeof Setting>,
  ) {
    return {
      code: 200,
      data: await this.service.setOpen(p.ipId, user, body.open),
    };
  }
  @Post()
  async submit(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Work)) body: z.infer<typeof Work>,
  ) {
    return {
      code: 200,
      data: await this.service.submit(p.ipId, user, body.workId),
    };
  }
  @Patch()
  async decide(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChannelSubmissionDecision))
    body: z.infer<typeof ChannelSubmissionDecision>,
  ) {
    return { code: 200, data: await this.service.decide(p.ipId, user, body) };
  }
}
