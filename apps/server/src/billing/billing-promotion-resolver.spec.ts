import { BillingService } from './billing.service';

/**
 * Unit tests for the AUTOMATIC promotion resolver's selection logic — the money
 * path that turns a no-code sale into a checkout discount. DB-level invariants
 * (CHECK constraints, NULLS-DISTINCT unique) are verified directly against
 * Postgres; here we pin the in-process decisions that must stay deterministic
 * and buyer-safe:
 *   - best discount wins, ties broken by id (never order-of-insertion)
 *   - exhausted / currency-mismatched / zero-discount / unsynced sales are
 *     SKIPPED (no discount), never thrown
 *   - the in-lock re-read can still disqualify under a race → null
 *
 * The resolver uses no `this` state, so we invoke it on a bare prototype with a
 * hand-rolled transaction client.
 */

type AnyPromotion = Record<string, unknown>;

const resolve = (
  tx: unknown,
  input: unknown,
): Promise<{ promotion: { id: string }; discountAmountMinor: bigint } | null> =>
  (
    BillingService.prototype as unknown as {
      resolveAutomaticPromotionTx: (
        tx: unknown,
        input: unknown,
      ) => Promise<never>;
      // resolveAutomaticPromotionTx delegates to this.findBestAutomaticPromotion;
      // the prototype is a sufficient `this` since neither method uses instance state.
    }
  ).resolveAutomaticPromotionTx.call(BillingService.prototype, tx, input);

function promo(overrides: Partial<AnyPromotion> = {}): AnyPromotion {
  return {
    id: 'p-1',
    applyMode: 'automatic',
    status: 'active',
    archivedAt: null,
    startsAt: null,
    endsAt: null,
    appliesPriceId: null,
    appliesItemId: null,
    appliesProductType: 'community_membership_plan',
    percentOffBps: 2000, // 20%
    amountOffMinor: null,
    amountOffCurrency: null,
    maxRedemptions: null,
    redemptionCount: 0,
    durationType: 'once',
    providerBindings: [{ providerCouponId: 'cpn_1' }],
    ...overrides,
  };
}

const PRICE = {
  id: 'price-1',
  itemId: 'item-1',
  currency: 'USD',
  item: { productType: 'community_membership_plan' },
} as const;

function makeTx(
  candidates: AnyPromotion[],
  freshById?: Record<string, AnyPromotion | null>,
) {
  return {
    billingPromotion: {
      findMany: jest.fn().mockResolvedValue(candidates),
      findUnique: jest
        .fn()
        .mockImplementation(({ where: { id } }: { where: { id: string } }) => {
          if (freshById && id in freshById)
            return Promise.resolve(freshById[id]);
          return Promise.resolve(candidates.find((c) => c.id === id) ?? null);
        }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
}

const baseInput = (extra: Record<string, unknown> = {}) => ({
  provider: 'airwallex',
  price: PRICE,
  subtotalAmountMinor: 1000n,
  now: new Date('2026-06-22T12:00:00Z'),
  ...extra,
});

describe('resolveAutomaticPromotionTx', () => {
  it('returns null when there are no automatic candidates', async () => {
    const tx = makeTx([]);
    expect(await resolve(tx, baseInput())).toBeNull();
  });

  it('applies a single eligible automatic sale (percent)', async () => {
    const tx = makeTx([promo({ id: 'p-1', percentOffBps: 2000 })]);
    const res = await resolve(tx, baseInput());
    expect(res?.promotion.id).toBe('p-1');
    expect(res?.discountAmountMinor).toBe(200n); // 20% of 1000
  });

  it('picks the BEST discount among competing sales', async () => {
    const tx = makeTx([
      promo({ id: 'small', percentOffBps: 1000 }), // 100
      promo({ id: 'big', percentOffBps: 3000 }), // 300
      promo({
        id: 'mid',
        amountOffMinor: 250,
        amountOffCurrency: 'USD',
        percentOffBps: null,
      }), // 250
    ]);
    const res = await resolve(tx, baseInput());
    expect(res?.promotion.id).toBe('big');
    expect(res?.discountAmountMinor).toBe(300n);
  });

  it('breaks ties by id deterministically (not insertion order)', async () => {
    const tx = makeTx([
      promo({ id: 'zeta', percentOffBps: 2000 }),
      promo({ id: 'alpha', percentOffBps: 2000 }),
    ]);
    const res = await resolve(tx, baseInput());
    expect(res?.promotion.id).toBe('alpha');
  });

  it('skips an exhausted sale (redemptionCount >= maxRedemptions)', async () => {
    const tx = makeTx([
      promo({ id: 'used', maxRedemptions: 5, redemptionCount: 5 }),
    ]);
    expect(await resolve(tx, baseInput())).toBeNull();
  });

  it('skips a fixed-amount sale whose currency does not match the price', async () => {
    const tx = makeTx([
      promo({
        id: 'eur',
        amountOffMinor: 300,
        amountOffCurrency: 'EUR',
        percentOffBps: null,
      }),
    ]);
    expect(await resolve(tx, baseInput())).toBeNull();
  });

  it('skips a sale that produces a zero discount', async () => {
    const tx = makeTx([promo({ id: 'zero', percentOffBps: 0 })]);
    expect(await resolve(tx, baseInput())).toBeNull();
  });

  it('skips a charge-requiring sale with no provider coupon (does not throw)', async () => {
    const tx = makeTx([promo({ id: 'unsynced', providerBindings: [] })]);
    expect(await resolve(tx, baseInput())).toBeNull();
  });

  it('allows a fully-free sale even without a provider coupon', async () => {
    const tx = makeTx([
      promo({ id: 'free', percentOffBps: 10000, providerBindings: [] }),
    ]);
    const res = await resolve(tx, baseInput());
    expect(res?.promotion.id).toBe('free');
    expect(res?.discountAmountMinor).toBe(1000n);
  });

  it('disqualifies on the in-lock re-read when the sale became exhausted under a race', async () => {
    const chosen = promo({ id: 'racy', maxRedemptions: 1, redemptionCount: 0 });
    // findMany saw it eligible; the locked re-read sees it exhausted.
    const tx = makeTx([chosen], {
      racy: { ...promo({ id: 'racy', maxRedemptions: 1, redemptionCount: 1 }) },
    });
    expect(await resolve(tx, baseInput())).toBeNull();
  });

  it('respects requiresProviderCoupon=false (internal/zero-provider flows)', async () => {
    const tx = makeTx([promo({ id: 'nocoupon', providerBindings: [] })]);
    const res = await resolve(tx, baseInput({ requiresProviderCoupon: false }));
    expect(res?.promotion.id).toBe('nocoupon');
  });
});
