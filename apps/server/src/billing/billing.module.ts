import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { WorkspacesModule } from '../workspaces';
import { BillingAdminController } from './billing-admin.controller';
import { BillingController } from './billing.controller';
import { BillingLedgerService } from './billing-ledger.service';
import { BillingService } from './billing.service';
import { PaymentProviderRegistry } from './payment-provider-registry.service';
import { AirwallexProvider } from './providers/airwallex.provider';
import { VoucherService } from './voucher.service';

@Module({
  imports: [AdminAuthModule, WorkspacesModule],
  controllers: [BillingController, BillingAdminController],
  providers: [
    BillingService,
    BillingLedgerService,
    PaymentProviderRegistry,
    AirwallexProvider,
    VoucherService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
