import { BillingSubscriptionStatus } from '@prisma/client';
import { BillingService } from './billing.service';

function fixture() {
  const original = {
    id: '00000000-0000-4000-8000-000000000001',
    userId: 'owner',
    subjectId: 'owner',
    subjectType: 'user',
    provider: 'airwallex',
    providerSubscriptionId: 'mandate-1',
    status: BillingSubscriptionStatus.active as BillingSubscriptionStatus,
    planKey: 'basic',
    currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
    canceledAt: null as Date | null,
    endedAt: null as Date | null,
    cancelAtPeriodEnd: false,
    price: {
      currency: 'USD',
      amountMinor: 200n,
      interval: 'month',
      item: { productType: 'membership_plan' },
    },
  };
  let current = { ...original };
  const update = jest
    .fn()
    .mockImplementation(({ data }: { data: Partial<typeof original> }) => {
      current = { ...current, ...data };
      return Promise.resolve(current);
    });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    billingSubscription: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(current)),
      update,
    },
  };
  const transaction = jest
    .fn()
    .mockImplementation((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    );
  const cancel = jest.fn().mockResolvedValue({ providerStatus: 'cancelled' });
  const db = {
    billingSubscription: { findUnique: jest.fn().mockResolvedValue(original) },
    $transaction: transaction,
  };
  const service = new BillingService(
    db as never,
    { get: () => ({ cancelSubscription: cancel }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return {
    service,
    cancel,
    update,
    transaction,
    original,
    setCurrent: (patch: Partial<typeof original>) => {
      current = { ...current, ...patch };
    },
  };
}
describe('Subscription cancellation recovery', () => {
  it('uses the paid period recorded while provider cancellation was pending', async () => {
    const f = fixture();
    const renewed = new Date('2026-11-01T00:00:00Z');
    f.cancel.mockImplementation(() => {
      f.setCurrent({ currentPeriodEnd: renewed });
      return Promise.resolve({});
    });
    const result = await f.service.cancelSubscription(
      { userId: 'owner' },
      f.original.id,
    );
    expect(result.endedAt).toBe(renewed.toISOString());
    expect(result.currentPeriodEnd).toBe(renewed.toISOString());
  });
  it.each([
    BillingSubscriptionStatus.canceled,
    BillingSubscriptionStatus.expired,
  ])('preserves a concurrent %s result', async (status) => {
    const f = fixture();
    const endedAt = new Date('2026-09-30T00:00:00Z');
    f.cancel.mockImplementation(() => {
      f.setCurrent({ status, endedAt });
      return Promise.resolve({});
    });
    const result = await f.service.cancelSubscription(
      { userId: 'owner' },
      f.original.id,
    );
    expect(result.status).toBe(status);
    expect(result.endedAt).toBe(endedAt.toISOString());
    expect(f.update).not.toHaveBeenCalled();
  });
  it('does not record cancellation against a replacement provider mandate', async () => {
    const f = fixture();
    f.cancel.mockImplementation(() => {
      f.setCurrent({ providerSubscriptionId: 'replacement' });
      return Promise.resolve({});
    });
    await expect(
      f.service.cancelSubscription({ userId: 'owner' }, f.original.id),
    ).rejects.toMatchObject({
      response: { code: 'BILLING_SUBSCRIPTION_CHANGED' },
    });
    expect(f.update).not.toHaveBeenCalled();
  });
  it('keeps the provider request identity stable after local recording fails', async () => {
    const f = fixture();
    f.transaction.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      f.service.cancelSubscription({ userId: 'owner' }, f.original.id),
    ).rejects.toThrow('database unavailable');
    await f.service.cancelSubscription({ userId: 'owner' }, f.original.id);
    expect(f.cancel).toHaveBeenCalledTimes(2);
    expect(f.cancel.mock.calls[0]).toEqual(f.cancel.mock.calls[1]);
    expect(f.cancel).toHaveBeenCalledWith({
      requestId: f.original.id,
      providerSubscriptionId: 'mandate-1',
      prorationBehavior: 'NONE',
    });
  });
  it('does not change local subscription state after provider failure', async () => {
    const f = fixture();
    f.cancel.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(
      f.service.cancelSubscription({ userId: 'owner' }, f.original.id),
    ).rejects.toThrow('provider unavailable');
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
  });
});
