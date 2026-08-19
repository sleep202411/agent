import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthGuard,
  AdminAuthService,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  type AdminActor,
} from '../admin-auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CrewsService } from './crews.service';
import {
  ListAdminCrewsQuerySchema,
  SetCrewModerationSchema,
  TransferCrewOwnerSchema,
  type ListAdminCrewsQuery,
  type SetCrewModerationInput,
  type TransferCrewOwnerInput,
} from './dto';

/**
 * /admin/crews — privileged crew operations that intentionally bypass the
 * owner-only self-service guards. The durable logic lives in
 * {@link CrewsService.transferOwnership}; this controller is the sanctioned
 * "act on any crew" surface (AdminAuthGuard + audit trail), distinct from the
 * future owner-facing transfer endpoint that will call the same service method
 * with the acting user pinned as the required current founder.
 */
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/crews')
export class CrewsAdminController {
  constructor(
    private readonly crews: CrewsService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  /** Patrol list — every crew, newest first, searchable + status-filterable. */
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListAdminCrewsQuerySchema))
    query: ListAdminCrewsQuery,
  ) {
    const data = await this.crews.adminList(query);
    return { code: 200, data };
  }

  /** Take a crew down / restore it. Post-hoc moderation with an audit reason. */
  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  @Post(':id/moderation')
  async setModeration(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetCrewModerationSchema))
    body: SetCrewModerationInput,
  ) {
    const data = await this.crews.setModeration(id, body.status, {
      adminId: admin.id,
      reason: body.reason,
    });
    await this.adminAuth.writeAudit({
      actor: admin,
      action:
        body.status === 'taken_down'
          ? 'admin.crew.moderation.takedown'
          : 'admin.crew.moderation.restore',
      resourceType: 'crew',
      resourceId: id,
      metadata: { status: body.status, reason: body.reason ?? null },
    });
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  @Post(':id/transfer-owner')
  async transferOwner(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransferCrewOwnerSchema))
    body: TransferCrewOwnerInput,
  ) {
    const data = await this.crews.transferOwnership(id, body.toUserId, {
      actor: { type: 'platform_admin', actorId: admin.id },
      removeOldOwner: body.removeOldOwner,
      expectedVersion: body.expectedVersion,
    });
    await this.adminAuth.writeAudit({
      actor: admin,
      action: 'admin.crew.owner.transfer',
      resourceType: 'crew',
      resourceId: id,
      metadata: {
        toUserId: body.toUserId,
        removeOldOwner: body.removeOldOwner ?? false,
      },
    });
    return { code: 200, data };
  }
}
