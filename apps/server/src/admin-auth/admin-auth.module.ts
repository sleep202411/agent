import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminPermissionGuard } from './admin-permission.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  controllers: [
    AdminAuthController,
    AdminUsersController,
    AdminAuditController,
  ],
  providers: [
    AdminAuthService,
    AdminUsersService,
    AdminAuditService,
    AdminAuthGuard,
    AdminPermissionGuard,
  ],
  exports: [
    AdminAuthService,
    AdminUsersService,
    AdminAuditService,
    AdminAuthGuard,
    AdminPermissionGuard,
  ],
})
export class AdminAuthModule {}
