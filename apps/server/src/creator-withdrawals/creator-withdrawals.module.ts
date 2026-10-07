import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WithdrawalProofsService } from './withdrawal-proofs.service';
import {
  CreatorWithdrawalProofsController,
  WithdrawalProofsController,
} from './withdrawal-proofs.controller';
import { RevenueDraftsService } from './revenue-drafts.service';
import { NotificationModule } from '../notification/notification.module';
import { StorageModule } from '../infra/storage/storage.module';
import { RevenueContractsService } from './revenue-contracts.service';
import { RevenueDistributionService } from './revenue-distribution.service';
import { RevenueAdminController } from './revenue-admin.controller';
import { RevenueAdminReadService } from './revenue-admin-read.service';
import { LegacyCreatorsModule } from '../legacy-creators/legacy-creators.module';
import { Module, type OnModuleInit } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import { WithdrawalAdminService } from './withdrawal-admin.service';
import {
  CreatorWithdrawalsController,
  CreatorWithdrawalsAdminController,
} from './creator-withdrawals.controller';
import { validateRecipientEncryptionKey } from './recipient-encryption';

@Module({
  imports: [
    AdminAuthModule,
    WorkspacesModule,
    NotificationModule,
    StorageModule,
    LegacyCreatorsModule,
  ],
  providers: [
    CreatorWithdrawalsService,
    WithdrawalAdminService,
    WithdrawalProofsService,
    RevenueContractsService,
    RevenueDistributionService,
    RevenueAdminReadService,
    RevenueDraftsService,
  ],
  controllers: [
    RevenueAdminController,
    WithdrawalProofsController,
    CreatorWithdrawalProofsController,
    CreatorWithdrawalsController,
    CreatorWithdrawalsAdminController,
  ],
})
export class CreatorWithdrawalsModule implements OnModuleInit {
  onModuleInit() {
    validateRecipientEncryptionKey();
  }
}
