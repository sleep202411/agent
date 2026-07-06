import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { EntitlementsModule } from '../entitlements';
import { ReferralsModule } from '../referrals/referrals.module';
import { WorkspacesModule } from '../workspaces';
import { BillingAdminController } from './billing-admin.controller';
import { BillingController } from './billing.controller';
import { BillingLedgerService } from './billing-ledger.service';
import { BillingService } from './billing.service';
import { AppLovinConversionService } from './applovin-conversion.service';
import { PaymentProviderRegistry } from './payment-provider-registry.service';
import { AirwallexProvider } from './providers/airwallex.provider';
import { WechatPayProvider } from './providers/wechat-pay.provider';
import { VoucherService } from './voucher.service';
import { CampaignService } from './campaign.service';
import { CheckInService } from './check-in.service';

@Module({
  imports: [
    AdminAuthModule,
    WorkspacesModule,
    EntitlementsModule,
    ReferralsModule,
  ],
  controllers: [BillingController, BillingAdminController],
  providers: [
    BillingService,
    AppLovinConversionService,
    BillingLedgerService,
    PaymentProviderRegistry,
    AirwallexProvider,
    WechatPayProvider,
    VoucherService,
    CampaignService,
    CheckInService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
