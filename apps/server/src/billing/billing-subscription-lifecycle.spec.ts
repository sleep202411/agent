import { BillingService } from './billing.service';

/**
 * Unit tests for the subscription-lifecycle webhook routing — the fix for the
 * audit's P0 where a provider subscription.cancelled/.expired event fell through
 * to 'ignored', leaving BillingSubscription.status stuck 'active' forever.
 *
 * tryApplySubscriptionLifecycleEvent uses only the tx + module helpers (no
 * instance state), so we invoke it on the prototype with a hand-rolled tx.
 */

const apply = (
  tx: unknown,
  providerEvent: unknown,
  eventType: string,
  payload: unknown,
): Promise<{ subscriptionId: string } | null> =>
  (
    BillingService.prototype as unknown as {
      tryApplySubscriptionLifecycleEvent: (
        tx: unknown,
        providerEvent: unknown,
        eventType: string,
        payload: unknown,
      ) => Promise<never>;
    }
  ).tryApplySubscriptionLifecycleEvent.call(
    BillingService.prototype,
    tx,
    providerEvent,
    eventType,
    payload,
  );

function makeTx(sub: Record<string, unknown> | null) {
  const update = jest
    .fn()
    .mockImplementation(({ data }) => ({ ...sub, ...data }));
  return {
    tx: {
      billingSubscription: {
        findFirst: jest.fn().mockResolvedValue(sub),
        update,
      },
    },
    update,
  };
}

const EVENT = { provider: 'airwallex' };
const payloadFor = (id: string) => ({ data: { subscription_id: id } });

function activeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bsub_1',
    provider: 'airwallex',
    providerSubscriptionId: 'sub_ext_1',
    status: 'active',
    currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
    canceledAt: null,
    ...overrides,
  };
}

describe('tryApplySubscriptionLifecycleEvent', () => {
  it('flips an active subscription to canceled on subscription.cancelled', async () => {
    const { tx, update } = makeTx(activeSub());
    const result = await apply(
      tx,
      EVENT,
      'subscription.cancelled',
      payloadFor('sub_ext_1'),
    );
    expect(result).toEqual({ subscriptionId: 'bsub_1' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.status).toBe('canceled');
    expect(update.mock.calls[0][0].data.cancelAtPeriodEnd).toBe(true);
    expect(update.mock.calls[0][0].data.canceledAt).toBeInstanceOf(Date);
  });

  it('flips to expired on subscription.expired', async () => {
    const { tx, update } = makeTx(activeSub());
    const result = await apply(
      tx,
      EVENT,
      'subscription.expired',
      payloadFor('sub_ext_1'),
    );
    expect(result).toEqual({ subscriptionId: 'bsub_1' });
    expect(update.mock.calls[0][0].data.status).toBe('expired');
  });

  it('treats subscription.deactivated as canceled', async () => {
    const { tx, update } = makeTx(activeSub());
    await apply(tx, EVENT, 'subscription.deactivated', payloadFor('sub_ext_1'));
    expect(update.mock.calls[0][0].data.status).toBe('canceled');
  });

  it('ignores non-terminal subscription events (created/updated/activated)', async () => {
    const { tx, update } = makeTx(activeSub());
    expect(
      await apply(tx, EVENT, 'subscription.created', payloadFor('sub_ext_1')),
    ).toBeNull();
    expect(
      await apply(tx, EVENT, 'subscription.updated', payloadFor('sub_ext_1')),
    ).toBeNull();
    expect(tx.billingSubscription.findFirst).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('ignores non-subscription events entirely', async () => {
    const { tx } = makeTx(activeSub());
    expect(
      await apply(
        tx,
        EVENT,
        'payment_intent.succeeded',
        payloadFor('sub_ext_1'),
      ),
    ).toBeNull();
    expect(
      await apply(tx, EVENT, 'invoice.payment.paid', payloadFor('sub_ext_1')),
    ).toBeNull();
    expect(tx.billingSubscription.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when no subscription matches the provider id', async () => {
    const { tx, update } = makeTx(null);
    expect(
      await apply(
        tx,
        EVENT,
        'subscription.cancelled',
        payloadFor('sub_missing'),
      ),
    ).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('is idempotent — already-canceled subscription matches but does not update', async () => {
    const { tx, update } = makeTx(activeSub({ status: 'canceled' }));
    const result = await apply(
      tx,
      EVENT,
      'subscription.cancelled',
      payloadFor('sub_ext_1'),
    );
    expect(result).toEqual({ subscriptionId: 'bsub_1' });
    expect(update).not.toHaveBeenCalled();
  });

  it('resolves the subscription id from data.id when subscription_id is absent', async () => {
    const { tx } = makeTx(activeSub());
    const result = await apply(tx, EVENT, 'subscription.cancelled', {
      data: { id: 'sub_ext_1' },
    });
    expect(result).toEqual({ subscriptionId: 'bsub_1' });
  });
});
