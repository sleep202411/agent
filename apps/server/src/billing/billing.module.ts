import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentProviderRegistry } from './payment-provider-registry.service';
import { AirwallexProvider } from './providers/airwallex.provider';

@Module({
  imports: [WorkspacesModule],
  controllers: [BillingController],
  providers: [BillingService, PaymentProviderRegistry, AirwallexProvider],
  exports: [BillingService],
})
export class BillingModule {}
