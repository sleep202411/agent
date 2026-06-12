import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { CURRENT_CELL } from '../common/region';
import { AirwallexProvider } from './providers/airwallex.provider';
import {
  UnsupportedPaymentProvider,
  type PaymentProviderAdapter,
} from './providers/payment-provider';

@Injectable()
export class PaymentProviderRegistry {
  private readonly alipay = new UnsupportedPaymentProvider(
    PaymentProvider.alipay,
  );
  private readonly wechatPay = new UnsupportedPaymentProvider(
    PaymentProvider.wechat_pay,
  );

  constructor(private readonly airwallex: AirwallexProvider) {}

  get(provider: PaymentProvider): PaymentProviderAdapter {
    if (provider === PaymentProvider.airwallex) return this.airwallex;
    if (provider === PaymentProvider.alipay) return this.alipay;
    if (provider === PaymentProvider.wechat_pay) return this.wechatPay;
    throw new ServiceUnavailableException({
      code: 'PAYMENT_PROVIDER_UNKNOWN',
      msg: `Payment provider "${provider}" is unknown.`,
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
