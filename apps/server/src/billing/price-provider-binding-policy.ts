import { BadRequestException } from '@nestjs/common';
import { BillingProviderBindingStatus, PaymentProvider } from '@prisma/client';
import type { Cell } from '../common/region/region.types';

export function isWechatAmountBasedPriceProvider(
  provider: PaymentProvider,
): boolean {
  return provider === PaymentProvider.wechat_pay;
}

/**
 * The China cell has one external payment rail: WeChat Pay. Its checkout uses
 * the amount stored on our billing price, so the binding is active immediately
 * and never enters a provider-catalog synchronization state. Other cells retain
 * their existing binding-state behavior.
 */
export function initialPriceProviderBindingStatus(input: {
  provider: PaymentProvider;
  currency: string;
  cell: Cell;
  requestedStatus: BillingProviderBindingStatus;
}): BillingProviderBindingStatus {
  const { provider, currency, cell, requestedStatus } = input;

  if (cell !== 'cn') return requestedStatus;

  if (provider === PaymentProvider.wechat_pay) {
    if (currency !== 'CNY') {
      throw new BadRequestException({
        code: 'PAYMENT_PROVIDER_CURRENCY_MISMATCH',
        msg: 'WeChat Pay prices must use CNY.',
      });
    }
    if (requestedStatus === BillingProviderBindingStatus.inactive) {
      return requestedStatus;
    }
    return BillingProviderBindingStatus.active;
  }

  if (
    provider === PaymentProvider.airwallex ||
    provider === PaymentProvider.alipay
  ) {
    throw new BadRequestException({
      code: 'PAYMENT_PROVIDER_SITE_MISMATCH',
      msg: 'The China site currently supports WeChat Pay only.',
    });
  }

  return requestedStatus;
}
