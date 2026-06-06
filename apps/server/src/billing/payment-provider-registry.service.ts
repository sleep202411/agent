import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { CURRENT_CELL } from '../common/region';
import { AirwallexProvider } from './providers/airwallex.provider';
import type { PaymentProviderAdapter } from './providers/payment-provider';

@Injectable()
export class PaymentProviderRegistry {
  constructor(private readonly airwallex: AirwallexProvider) {}

  get(provider: PaymentProvider): PaymentProviderAdapter {
    if (provider === PaymentProvider.airwallex) return this.airwallex;
    throw new ServiceUnavailableException({
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      msg: `Payment provider "${provider}" is not configured.`,
    });
  }

  defaultProviderForRuntime(): PaymentProvider {
    const configured = process.env.PAYMENT_PROVIDER?.trim();
    if (configured && configured in PaymentProvider) {
      return configured as PaymentProvider;
    }
    return CURRENT_CELL === 'cn'
      ? PaymentProvider.wechat_pay
      : PaymentProvider.airwallex;
  }
}
