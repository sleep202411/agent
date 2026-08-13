import { BillingService, unwrapProviderPayload } from './billing.service';
import { PaymentProvider } from '@prisma/client';

/**
 * Airwallex ships two webhook envelopes and every `['data', …]` lookup in
 * billing.service was written against only one of them.
 *
 *   Payments API   `data.object` wraps the resource
 *   Billing API    the resource fields sit directly on `data`
 *
 * The consequence on .com: `payment_intent.succeeded` for the first real
 * customer top-up (order FD202608101707159A2589B51E, USD 10) resolved every
 * candidate key to null, so `matchPaymentIntent` built an EMPTY `OR` list and
 * returned before querying — the matching `billing_payment_intents` row was
 * never compared against. The event was filed 'ignored' with "No matching
 * payment intent or refund found.", which reads like a lookup that failed
 * rather than one that never ran, and the customer's points never landed.
 *
 * Payloads below are trimmed from the real rows in production.
 */

/** Real Airwallex Payments envelope (`data.object`). */
const paymentsEnvelope = {
  id: 'evt_sgpdrplk4hl7wew9s00_e748r4',
  name: 'payment_intent.succeeded',
  account_id: 'acct_x',
  version: '2024-01-01',
  created_at: '2026-08-10T17:07:58+0000',
  data: {
    object: {
      id: 'int_sgpdrplk4hl7we748r4',
      amount: 10,
      status: 'SUCCEEDED',
      currency: 'USD',
      merchant_order_id: 'FD202608101707159A2589B51E',
      metadata: {
        fizzdragon_user_id: '13568',
        fizzdragon_order_id: '019feca4-8fc4-75f6-a0c6-0fe6b98436ef',
        fizzdragon_order_no: 'FD202608101707159A2589B51E',
      },
    },
  },
};

/** Real Airwallex Billing envelope (fields directly on `data`). */
const billingEnvelope = {
  id: 'evt_billing_1',
  name: 'billing_transaction.succeeded',
  org_id: 'org_x',
  version: '2024-01-01',
  created_at: '2026-06-23T00:00:00+0000',
  data: {
    id: 'btx_1',
    amount: 33,
    currency: 'SGD',
    invoice_id: 'inv_sgpdfvlfchjql8xbmfy',
    billing_customer_id: 'bcus_1',
  },
};

describe('unwrapProviderPayload', () => {
  it('lifts the Payments resource onto `data` so the shared lookups reach it', () => {
    const flat = unwrapProviderPayload(paymentsEnvelope) as {
      data: Record<string, unknown>;
      name: string;
    };

    expect(flat.data.id).toBe('int_sgpdrplk4hl7we748r4');
    expect(
      (flat.data.metadata as Record<string, string>).fizzdragon_order_id,
    ).toBe('019feca4-8fc4-75f6-a0c6-0fe6b98436ef');
    // The envelope itself must survive — eventTypeFromPayload reads `name`.
    expect(flat.name).toBe('payment_intent.succeeded');
  });

  it('leaves the Billing envelope untouched', () => {
    expect(unwrapProviderPayload(billingEnvelope)).toEqual(billingEnvelope);
  });

  it('passes through anything without a `data.object` record', () => {
    for (const payload of [
      { data: null },
      { data: { object: null } },
      { data: { object: 'not-a-record' } },
      { name: 'x' },
      {},
    ]) {
      expect(unwrapProviderPayload(payload)).toEqual(payload);
    }
  });
});

describe('matchPaymentIntent against both envelopes', () => {
  const capture = async (payload: Record<string, unknown>) => {
    let where: { OR?: unknown[] } | undefined;
    const tx = {
      billingPaymentIntent: {
        findFirst: (args: { where: { OR?: unknown[] } }) => {
          where = args.where;
          return Promise.resolve(null);
        },
      },
    };
    await (
      BillingService.prototype as unknown as {
        matchPaymentIntent: (
          tx: unknown,
          provider: PaymentProvider,
          payload: Record<string, unknown>,
        ) => Promise<unknown>;
      }
    ).matchPaymentIntent.call(
      BillingService.prototype,
      tx,
      PaymentProvider.airwallex,
      payload,
    );
    return where;
  };

  it('queries on both the order id and the provider intent id', async () => {
    // Mirrors production: the payload goes through providerPayloadRecord first.
    const where = await capture(unwrapProviderPayload(paymentsEnvelope));

    expect(where?.OR).toEqual(
      expect.arrayContaining([
        { orderId: '019feca4-8fc4-75f6-a0c6-0fe6b98436ef' },
        { providerPaymentIntentId: 'int_sgpdrplk4hl7we748r4' },
      ]),
    );
  });

  /**
   * The regression itself: without unwrapping, every candidate is null, the OR
   * list is empty and the function returns without ever touching the database.
   */
  it('issued no query at all before the fix', async () => {
    expect(await capture(paymentsEnvelope)).toBeUndefined();
  });
});
