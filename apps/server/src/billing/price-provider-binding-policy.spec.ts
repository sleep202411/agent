import { BadRequestException } from '@nestjs/common';
import { BillingProviderBindingStatus, PaymentProvider } from '@prisma/client';
import {
  initialPriceProviderBindingStatus,
  isWechatAmountBasedPriceProvider,
} from './price-provider-binding-policy';

describe('price provider binding policy', () => {
  it('activates amount-based WeChat prices immediately in the China cell', () => {
    expect(isWechatAmountBasedPriceProvider(PaymentProvider.wechat_pay)).toBe(
      true,
    );
    expect(isWechatAmountBasedPriceProvider(PaymentProvider.airwallex)).toBe(
      false,
    );
    expect(
      initialPriceProviderBindingStatus({
        provider: PaymentProvider.wechat_pay,
        currency: 'CNY',
        cell: 'cn',
        requestedStatus: BillingProviderBindingStatus.sync_pending,
      }),
    ).toBe(BillingProviderBindingStatus.active);
  });

  it('rejects non-CNY WeChat prices in the China cell', () => {
    expect(() =>
      initialPriceProviderBindingStatus({
        provider: PaymentProvider.wechat_pay,
        currency: 'USD',
        cell: 'cn',
        requestedStatus: BillingProviderBindingStatus.sync_pending,
      }),
    ).toThrow(BadRequestException);
  });

  it('preserves an explicitly inactive WeChat binding', () => {
    expect(
      initialPriceProviderBindingStatus({
        provider: PaymentProvider.wechat_pay,
        currency: 'CNY',
        cell: 'cn',
        requestedStatus: BillingProviderBindingStatus.inactive,
      }),
    ).toBe(BillingProviderBindingStatus.inactive);
  });

  it.each([PaymentProvider.airwallex, PaymentProvider.alipay])(
    'rejects %s in the WeChat-only China cell',
    (provider) => {
      expect(() =>
        initialPriceProviderBindingStatus({
          provider,
          currency: 'CNY',
          cell: 'cn',
          requestedStatus: BillingProviderBindingStatus.sync_pending,
        }),
      ).toThrow(BadRequestException);
    },
  );

  it.each([
    [PaymentProvider.airwallex, BillingProviderBindingStatus.sync_pending],
    [PaymentProvider.wechat_pay, BillingProviderBindingStatus.inactive],
    [PaymentProvider.manual, BillingProviderBindingStatus.sync_failed],
  ])(
    'does not change %s binding state outside the China cell',
    (provider, status) => {
      expect(
        initialPriceProviderBindingStatus({
          provider,
          currency: 'USD',
          cell: 'global',
          requestedStatus: status,
        }),
      ).toBe(status);
    },
  );

  it.each([PaymentProvider.manual, PaymentProvider.internal])(
    'preserves the local %s rail in the China cell',
    (provider) => {
      const requestedStatus = BillingProviderBindingStatus.inactive;
      expect(
        initialPriceProviderBindingStatus({
          provider,
          currency: 'CNY',
          cell: 'cn',
          requestedStatus,
        }),
      ).toBe(requestedStatus);
    },
  );
});
