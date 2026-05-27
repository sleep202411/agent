import { Module } from '@nestjs/common';
import { PlatformAuditLogService } from './audit-log.service';
import { WalletLedgerService } from './wallet-ledger.service';
import { WorkspacePermissionService } from './workspace-permission.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  controllers: [WorkspacesController],
  providers: [
    WorkspacesService,
    WorkspacePermissionService,
    WalletLedgerService,
    PlatformAuditLogService,
  ],
  exports: [
    WorkspacesService,
    WorkspacePermissionService,
    WalletLedgerService,
    PlatformAuditLogService,
  ],
})
export class WorkspacesModule {}
