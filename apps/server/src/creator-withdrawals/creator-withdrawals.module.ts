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
    NotificationModule,
    StorageModule,
    LegacyCreatorsModule,
  ],
  providers: [
    CreatorWithdrawalsService,
    WithdrawalAdminService,
    RevenueContractsService,
    RevenueDistributionService,
    RevenueAdminReadService,
  ],
  controllers: [
    RevenueAdminController,
    CreatorWithdrawalsController,
    CreatorWithdrawalsAdminController,
  ],
})
export class CreatorWithdrawalsModule implements OnModuleInit {
  onModuleInit() {
    validateRecipientEncryptionKey();
  }
}
