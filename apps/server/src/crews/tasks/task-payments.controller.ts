import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SkipEndUserAuth } from '../../auth';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  CurrentAdmin,
  RequireAdminPermissions,
  ADMIN_PERMISSION_KEYS,
  type AdminActor,
} from '../../admin-auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import {
  ReleaseTaskPayment,
  TaskPaymentsService,
} from './task-payments.service';
@SkipEndUserAuth()
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions(ADMIN_PERMISSION_KEYS.CreatorRevenueManage)
@Controller('admin/task-payments')
export class TaskPaymentsController {
  constructor(private readonly payments: TaskPaymentsService) {}
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    return this.payments.detail(admin, id);
  }
  @Post(':id/release')
  @Header('Cache-Control', 'no-store')
  release(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReleaseTaskPayment))
    body: z.infer<typeof ReleaseTaskPayment>,
  ) {
    return this.payments.release(admin, id, body);
  }
}
