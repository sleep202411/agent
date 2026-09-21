import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { WechatRefundUnconfirmedException } from './providers/wechat-pay.provider';
const notification = {
  mchid: 'merchant',
  out_trade_no: 'order-no',
  out_refund_no: 'refund-no',
  refund_id: 'wx-refund',
  refund_status: 'SUCCESS',
  amount: { refund: 2500, total: 10000 },
};
type RefundRow = {
  id: string;
  refundNo: string;
  provider: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  providerRefundId: string | null;
  order: { orderNo: string; amountMinor: bigint };
};
describe('WeChat refund lifecycle', () => {
  let service: BillingService;
  let row: RefundRow;
  function makeDb() {
    return {
      $executeRaw: jest.fn(),
      billingRefund: {
        findFirst: jest.fn(
          (): Promise<RefundRow | null> => Promise.resolve(row),
        ),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(row)),
        findUnique: jest.fn(() => Promise.resolve(null)),
        update: jest.fn(({ data }: { data: Partial<RefundRow> }) =>
          Promise.resolve(Object.assign(row, data)),
        ),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown): unknown => cb(db)),
    };
  }
  function makeHelpers() {
    return {
      wechatPay: { verifyAndDecryptNotification: jest.fn(() => notification) },
      getAdminRefundForTx: jest.fn(() => Promise.resolve(row)),
      recordRefundEventTx: jest.fn(),
      finalizeRefundSucceededTx: jest.fn(() => {
        row.status = 'succeeded';
        return Promise.resolve(row);
      }),
      failRefundTx: jest.fn(() => {
        row.status = 'failed';
        return Promise.resolve(row);
      }),
    };
  }
  let db: ReturnType<typeof makeDb>;
  let helpers: ReturnType<typeof makeHelpers>;
  beforeEach(() => {
    row = {
      id: 'refund',
      refundNo: 'refund-no',
      provider: 'wechat_pay',
      status: 'requested',
      amountMinor: 2500n,
      currency: 'CNY',
      providerRefundId: null,
      order: { orderNo: 'order-no', amountMinor: 10000n },
    };
    db = makeDb();
    helpers = makeHelpers();
    service = Object.create(BillingService.prototype) as BillingService;
    Object.assign(service, { prisma: db, ...helpers });
  });
  it('matches early callbacks and settles duplicate callbacks only once', async () => {
    await service.handleWechatWebhook({ rawBody: Buffer.from('{}') });
    await service.handleWechatWebhook({ rawBody: Buffer.from('{}') });
    expect(row.providerRefundId).toBe('wx-refund');
    expect(helpers.finalizeRefundSucceededTx).toHaveBeenCalledTimes(1);
  });
  it.each(['order', 'amount', 'total', 'currency', 'providerId', 'missing'])(
    'rejects mismatched %s without settling',
    async (kind) => {
      if (kind === 'order') row.order.orderNo = 'another';
      if (kind === 'amount') row.amountMinor = 2000n;
      if (kind === 'total') row.order.amountMinor = 9000n;
      if (kind === 'currency') row.currency = 'USD';
      if (kind === 'providerId') row.providerRefundId = 'another';
      if (kind === 'missing')
        db.billingRefund.findFirst.mockResolvedValue(null);
      await expect(
        service.handleWechatWebhook({ rawBody: Buffer.from('{}') }),
      ).rejects.toThrow();
      expect(helpers.finalizeRefundSucceededTx).not.toHaveBeenCalled();
      expect(db.billingRefund.update).not.toHaveBeenCalled();
    },
  );
  it.each(['PROCESSING', 'ABNORMAL'])('keeps %s pending', async (status) => {
    helpers.wechatPay.verifyAndDecryptNotification.mockReturnValue({
      ...notification,
      refund_status: status,
    });
    await service.handleWechatWebhook({ rawBody: Buffer.from('{}') });
    expect(row.status).toBe('provider_pending');
    expect(helpers.failRefundTx).not.toHaveBeenCalled();
    expect(helpers.finalizeRefundSucceededTx).not.toHaveBeenCalled();
  });
  it('routes CLOSED to the existing benefit reversal flow', async () => {
    helpers.wechatPay.verifyAndDecryptNotification.mockReturnValue({
      ...notification,
      refund_status: 'CLOSED',
    });
    await service.handleWechatWebhook({ rawBody: Buffer.from('{}') });
    expect(helpers.failRefundTx).toHaveBeenCalledTimes(1);
  });
  it('does not reopen success on a delayed PROCESSING response', async () => {
    row.status = 'succeeded';
    helpers.wechatPay.verifyAndDecryptNotification.mockReturnValue({
      ...notification,
      refund_status: 'PROCESSING',
    });
    await service.handleWechatWebhook({ rawBody: Buffer.from('{}') });
    expect(db.billingRefund.update).not.toHaveBeenCalled();
  });
  it('passes original total and retains reservations on unconfirmed submissions', async () => {
    const createRefund = jest
      .fn()
      .mockRejectedValue(new WechatRefundUnconfirmedException());
    Object.assign(service, {
      providerRegistry: { get: () => ({ createRefund }) },
    });
    const prepareAdminRefundTx = jest.fn(() =>
      Promise.resolve({
        refund: {
          ...row,
          requestId: 'request',
          reasonCode: 'customer_request',
        },
        originalAmountMinor: 10000n,
        providerPaymentIntentId: 'order-no',
      }),
    );
    const markRefundFailedAfterProviderError = jest.fn();
    Object.assign(service, {
      prepareAdminRefundTx,
      markRefundFailedAfterProviderError,
    });
    await expect(
      service.createAdminRefund('admin', {
        idempotencyKey: 'intent',
        orderId: 'order',
        reasonCode: 'customer_request',
      }),
    ).rejects.toBeInstanceOf(WechatRefundUnconfirmedException);
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 2500n,
        originalAmountMinor: 10000n,
      }),
    );
    expect(markRefundFailedAfterProviderError).not.toHaveBeenCalled();
    expect(db.billingRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'refund', status: 'requested' },
        data: expect.objectContaining({
          status: 'provider_pending',
        }) as unknown,
      }),
    );
  });
});

it('acknowledges WeChat notifications with HTTP 200 rather than the POST default', () => {
  expect(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      // Method metadata is inspected; the handler is not invoked unbound.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      BillingController.prototype.handleWechatWebhook,
    ),
  ).toBe(200);
});
