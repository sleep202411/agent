import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { Public } from '../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { readIpProductionEvidence } from './ip-production-evidence';

export const ProductionStageChange = z
  .object({
    stage: z.enum(['testing', 'story_testing', 'production', 'released']),
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export type ProductionStageState = { stage: string; version: number };

export async function readProductionStage(
  tx: Prisma.TransactionClient,
  ipId: string,
): Promise<ProductionStageState> {
  const [row] = await tx.$queryRaw<ProductionStageState[]>`
    SELECT COALESCE(s.stage,'testing') AS stage, COALESCE(s.version,0)::int AS version
    FROM ips ip LEFT JOIN ip_production_stages s ON s.ip_id=ip.id
    WHERE ip.id=${ipId}::uuid AND ip.deleted_at IS NULL`;
  if (!row) throw new NotFoundException('IP not found.');
  return row;
}

export async function assertCurrentAuthority(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
) {
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
      JOIN admin_user_roles ur ON ur.user_id=u.id JOIN admin_role_permissions rp ON rp.role_id=ur.role_id
      JOIN admin_permissions p ON p.id=rp.permission_id
      WHERE s.id=${actor.sessionId}::uuid AND u.id=${actor.id}::uuid
      AND s.status='active' AND s.expires_at > clock_timestamp() AND u.status='active'
      AND p.key=${ADMIN_PERMISSION_KEYS.IpPublish}) AS allowed`;
  if (!row?.allowed)
    throw new ForbiddenException(
      'Current administrator publication permission is required.',
    );
}

export async function changeProductionStage(
  db: PrismaService,
  actor: AdminActor,
  ipId: string,
  input: z.infer<typeof ProductionStageChange>,
) {
  return db.$transaction((tx) =>
    changeProductionStageTx(tx, actor, ipId, input),
  );
}

export async function changeProductionStageTx(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  ipId: string,
  input: z.infer<typeof ProductionStageChange>,
) {
  await tx.$queryRaw`SELECT id FROM ips WHERE id=${ipId}::uuid FOR UPDATE /* production-stage */`;
  await lockProductionAuthority(tx, actor);
  const before = await readProductionStage(tx, ipId);
  if (before.version !== input.expectedVersion)
    throw new ConflictException(
      'Production stage changed. Refresh before reviewing again.',
    );
  if (before.stage === input.stage)
    throw new ConflictException('The IP is already in this production stage.');
  const evidence = await readIpProductionEvidence(tx, ipId);
  const after = { stage: input.stage, version: before.version + 1 };
  await tx.$executeRaw`INSERT INTO ip_production_stages(ip_id,stage,version) VALUES (${ipId}::uuid,${after.stage},${after.version})
      ON CONFLICT(ip_id) DO UPDATE SET stage=EXCLUDED.stage,version=EXCLUDED.version,updated_at=clock_timestamp()`;
  await tx.adminAuditLog.create({
    data: {
      actorUserId: actor.id,
      actorSessionId: actor.sessionId,
      siteScope: actor.siteScope,
      action: 'admin.ip.production_stage',
      resourceType: 'ip',
      resourceId: ipId,
      reason: input.reason,
      before,
      after,
      metadata: { evidence: evidence as unknown as Prisma.InputJsonValue },
    },
  });
  await assertCurrentAuthority(tx, actor);
  return after;
}

const Params = z.object({ ipId: z.string().uuid() });
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/ip-commerce/ips/:ipId/production-stage')
export class IpProductionStageController {
  constructor(private readonly db: PrismaService) {}
  @Get()
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpRead)
  async read(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
  ) {
    return { code: 200, data: await readProductionStage(this.db, params.ipId) };
  }
  @Patch()
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.IpPublish)
  async change(
    @CurrentAdmin() actor: AdminActor,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @Body(new ZodValidationPipe(ProductionStageChange))
    input: z.infer<typeof ProductionStageChange>,
  ) {
    return {
      code: 200,
      data: await changeProductionStage(this.db, actor, params.ipId, input),
    };
  }
}

export async function lockProductionAuthority(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
) {
  // Freeze existing authority rows until commit. Revocations that committed
  // during the IP wait are seen by the fresh check below.
  await tx.$queryRaw`SELECT s.id FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
      JOIN admin_user_roles ur ON ur.user_id=u.id JOIN admin_role_permissions rp ON rp.role_id=ur.role_id
      JOIN admin_permissions p ON p.id=rp.permission_id
      WHERE s.id=${actor.sessionId}::uuid AND u.id=${actor.id}::uuid AND p.key=${ADMIN_PERMISSION_KEYS.IpPublish}
      FOR SHARE OF s,u,ur,rp,p`;
  await assertCurrentAuthority(tx, actor);
}
