import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ADMIN_PERMISSION_KEYS } from './admin-auth.constants';
import { RequireAdminPermissions } from './admin-auth.decorator';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminPermissionGuard } from './admin-permission.guard';
import {
  ListAdminAuditQuerySchema,
  type ListAdminAuditQuery,
} from './admin-audit.dto';
import { AdminAuditService } from './admin-audit.service';

@Public()
@Controller('admin/audit')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(ADMIN_PERMISSION_KEYS.AuditRead)
export class AdminAuditController {
  constructor(private readonly adminAudit: AdminAuditService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListAdminAuditQuerySchema))
    query: ListAdminAuditQuery,
  ) {
    return { code: 200, data: await this.adminAudit.list(query) };
  }
}
