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
import { PositionsService } from './positions.service';
import {
  ListAdminPositionsQuerySchema,
  SetPositionModerationSchema,
  type ListAdminPositionsQuery,
  type SetPositionModerationInput,
} from './dto';

/**
 * /admin/crew-positions — post-hoc moderation of crew recruitment postings.
 * Mirrors {@link CrewsAdminController}: patrol every posting, take an abusive
 * one down (hidden from the public plaza + crew page), restore on appeal.
 */
@Public()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@Controller('admin/crew-positions')
export class CrewPositionsAdminController {
  constructor(
    private readonly positions: PositionsService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListAdminPositionsQuerySchema))
    query: ListAdminPositionsQuery,
  ) {
    const data = await this.positions.adminList(query);
    return { code: 200, data };
  }

  @RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CrewManage)
  @Post(':id/moderation')
  async setModeration(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetPositionModerationSchema))
    body: SetPositionModerationInput,
  ) {
    const data = await this.positions.setModeration(id, body.status, {
      adminId: admin.id,
      reason: body.reason,
    });
    await this.adminAuth.writeAudit({
      actor: admin,
      action:
        body.status === 'taken_down'
          ? 'admin.crew_position.moderation.takedown'
          : 'admin.crew_position.moderation.restore',
      resourceType: 'crew_position',
      resourceId: id,
      metadata: { status: body.status, reason: body.reason ?? null },
    });
    return { code: 200, data };
  }
}
