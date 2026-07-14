import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
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
import { TransferCrewOwnerSchema, type TransferCrewOwnerInput } from './dto';

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

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  @Post(':id/transfer-owner')
  async transferOwner(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransferCrewOwnerSchema))
    body: TransferCrewOwnerInput,
  ) {
    const data = await this.crews.transferOwnership(id, body.toUserId, {
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
