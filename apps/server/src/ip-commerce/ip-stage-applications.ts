import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { CurrentUser, Public, type AuthUser } from '../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { IpCommerceService } from './ip-commerce.service';
import {
  assertCurrentAuthority,
  lockProductionAuthority,
  changeProductionStageTx,
  readProductionStage,
} from './ip-production-stage';

export const StageApplicationInput = z
  .object({
    id: z.string().uuid(),
    stage: z.enum(['story_testing', 'production', 'released']),
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const Review = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const Params = z.object({ ipId: z.string().uuid() });
const ReviewParams = Params.extend({ applicationId: z.string().uuid() });
export interface StageApplication {
  id: string;
  applicantId: string;
  stage: string;
  stageVersion: number;
  reason: string;
  status: string;
  reviewReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}
const select = Prisma.sql`id,applicant_id AS "applicantId",target_stage AS stage,stage_version AS "stageVersion",reason,status,review_reason AS "reviewReason",created_at AS "createdAt",reviewed_at AS "reviewedAt"`;

@Injectable()
export class IpStageApplicationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ips: IpCommerceService,
  ) {}
  async list(ipId: string, user?: AuthUser) {
    return this.db.$transaction(
      async (tx) => {
        if (user) await this.ips.requireEditableIp(user, ipId, tx);
        const state = await readProductionStage(tx, ipId);
        const items = await tx.$queryRaw<StageApplication[]>(
          Prisma.sql`SELECT ${select} FROM ip_stage_applications WHERE ip_id=${ipId}::uuid ORDER BY (status='pending') DESC,created_at DESC,id DESC LIMIT 20`,
        );
        return { state, items };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async submit(
    ipId: string,
    user: AuthUser,
    input: z.infer<typeof StageApplicationInput>,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ip:acl:${ipId}`})::bigint)`;
      await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
      await this.ips.requireEditableIp(user, ipId, tx);
      const [previous] = await tx.$queryRaw<StageApplication[]>(
        Prisma.sql`SELECT ${select} FROM ip_stage_applications WHERE ip_id=${ipId}::uuid AND id=${input.id}::uuid`,
      );
      if (previous) {
        if (
          previous.applicantId !== user.userId ||
          previous.stage !== input.stage ||
          previous.stageVersion !== input.expectedVersion ||
          previous.reason !== input.reason
        )
          throw new ConflictException('Application identity already used.');
        return previous;
      }
      const state = await readProductionStage(tx, ipId);
      if (
        state.version !== input.expectedVersion ||
        state.stage === input.stage
      )
        throw new ConflictException(
          'Production stage changed. Refresh before applying.',
        );
      const pending = await tx.$queryRaw<
        unknown[]
      >`SELECT id FROM ip_stage_applications WHERE ip_id=${ipId}::uuid AND status='pending'`;
      if (pending.length)
        throw new ConflictException(
          'An application is already awaiting review.',
        );
      const [item] = await tx.$queryRaw<
        StageApplication[]
      >(Prisma.sql`INSERT INTO ip_stage_applications(id,ip_id,applicant_id,target_stage,stage_version,reason)
        VALUES(${input.id}::uuid,${ipId}::uuid,${user.userId},${input.stage},${input.expectedVersion},${input.reason}) ON CONFLICT DO NOTHING RETURNING ${select}`);
      if (!item)
        throw new ConflictException('Application identity already used.');
      await this.ips.requireEditableIp(user, ipId, tx);
      return item;
    });
  }
  async review(
    ipId: string,
    id: string,
    actor: AdminActor,
    input: z.infer<typeof Review>,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE`;
      await lockProductionAuthority(tx, actor);
      const [application] = await tx.$queryRaw<StageApplication[]>(
        Prisma.sql`SELECT ${select} FROM ip_stage_applications WHERE ip_id=${ipId}::uuid AND id=${id}::uuid FOR UPDATE`,
      );
      if (!application) throw new NotFoundException('Application not found.');
      if (application.status !== 'pending')
        throw new ConflictException('Application already reviewed. Refresh.');
      if (input.decision === 'approved')
        await changeProductionStageTx(tx, actor, ipId, {
          stage: application.stage as
            | 'story_testing'
            | 'production'
            | 'released',
          expectedVersion: application.stageVersion,
          reason: input.reason,
        });
      const [result] = await tx.$queryRaw<StageApplication[]>(
        Prisma.sql`UPDATE ip_stage_applications SET status=${input.decision},reviewer_id=${actor.id}::uuid,review_reason=${input.reason},reviewed_at=clock_timestamp() WHERE id=${id}::uuid RETURNING ${select}`,
      );
      await tx.adminAuditLog.create({
        data: {
          actorUserId: actor.id,
          actorSessionId: actor.sessionId,
          siteScope: actor.siteScope,
          action: 'admin.ip.stage_application',
          resourceType: 'ip',
          resourceId: ipId,
          reason: input.reason,
          metadata: { applicationId: id, decision: input.decision },
        },
      });
      await assertCurrentAuthority(tx, actor);
      return result;
    });
  }
}

@Controller('ip-commerce/me/ips/:ipId/stage-applications')
export class IpStageApplicationsController {
  constructor(private readonly service: IpStageApplicationsService) {}
  @Get() list(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.list(p.ipId, user);
  }
  @Post() submit(
    @Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StageApplicationInput))
    input: z.infer<typeof StageApplicationInput>,
  ) {
    return this.service.submit(p.ipId, user, input);
  }
}
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/ip-commerce/ips/:ipId/stage-applications')
export class IpStageApplicationsAdminController {
  constructor(private readonly service: IpStageApplicationsService) {}
  @Get()
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  async list(@Param(new ZodValidationPipe(Params)) p: z.infer<typeof Params>) {
    return { code: 200, data: await this.service.list(p.ipId) };
  }
  @Post(':applicationId/review')
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpPublish)
  async review(
    @Param(new ZodValidationPipe(ReviewParams)) p: z.infer<typeof ReviewParams>,
    @CurrentAdmin() actor: AdminActor,
    @Body(new ZodValidationPipe(Review)) input: z.infer<typeof Review>,
  ) {
    return {
      code: 200,
      data: await this.service.review(p.ipId, p.applicationId, actor, input),
    };
  }
}
