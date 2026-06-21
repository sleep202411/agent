import { applyMemberDiscount, computeRevenueSplit } from './revenue-split';

const OWNER = 'owner-1';

describe('applyMemberDiscount', () => {
  it('no discount (bps 0) → charges the list amount', () => {
    expect(applyMemberDiscount(100n, 0)).toBe(100n);
  });
  it('20% off, floor semantics', () => {
    expect(applyMemberDiscount(100n, 2000)).toBe(80n);
    // floor(99 * 2000 / 10000) = floor(19.8) = 19 → 99 - 19 = 80
    expect(applyMemberDiscount(99n, 2000)).toBe(80n);
  });
  it('100% off (bps 10000) → free', () => {
    expect(applyMemberDiscount(100n, 10000)).toBe(0n);
  });
  it('clamps out-of-range / fractional bps', () => {
    expect(applyMemberDiscount(100n, -5)).toBe(100n);
    expect(applyMemberDiscount(100n, 20000)).toBe(0n);
    // trunc(1.9) = 1 → floor(100 * 1 / 10000) = 0 → 100
    expect(applyMemberDiscount(100n, 1.9)).toBe(100n);
  });
  it('zero list amount → 0', () => {
    expect(applyMemberDiscount(0n, 2000)).toBe(0n);
  });
  it('charged amount always in [0, amount]', () => {
    for (const amt of [1n, 7n, 50n, 333n, 100000n]) {
      for (const bps of [0, 1, 2000, 5000, 9999, 10000]) {
        const c = applyMemberDiscount(amt, bps);
        expect(c >= 0n && c <= amt).toBe(true);
      }
    }
  });
});

function sum(amts: bigint[]): bigint {
  return amts.reduce((a, b) => a + b, 0n);
}

describe('computeRevenueSplit', () => {
  it('owner-only: no eligible contributors → owner takes the whole pool', () => {
    const r = computeRevenueSplit({
      totalAmount: 100n,
      shareBps: 5000,
      ownerUserId: OWNER,
      contributors: [],
    });
    expect(r.creatorPool).toBe(50n);
    expect(r.platformCut).toBe(50n);
    expect(r.beneficiaries).toEqual([
      { userId: OWNER, amount: 50n, shareBps: 10000 },
    ]);
  });

  it('invariant: platformCut + Σbeneficiaries === total (owner-only)', () => {
    const r = computeRevenueSplit({
      totalAmount: 100n,
      shareBps: 5000,
      ownerUserId: OWNER,
      contributors: [],
    });
    expect(r.platformCut + sum(r.beneficiaries.map((b) => b.amount))).toBe(
      100n,
    );
  });

  it('weighted multi-contributor split, remainder to owner', () => {
    // pool = floor(100 * 5000/10000) = 50.
    // owner 60% → 30, writer 25% → 12, artist 15% → floor(7.5)=7. allocated=49.
    // remainder 1 → owner (owner already a beneficiary → merged to 31).
    const r = computeRevenueSplit({
      totalAmount: 100n,
      shareBps: 5000,
      ownerUserId: OWNER,
      contributors: [
        { userId: OWNER, shareBps: 6000 },
        { userId: 'writer', shareBps: 2500 },
        { userId: 'artist', shareBps: 1500 },
      ],
    });
    const byUser = Object.fromEntries(
      r.beneficiaries.map((b) => [b.userId, b.amount]),
    );
    expect(byUser[OWNER]).toBe(31n);
    expect(byUser['writer']).toBe(12n);
    expect(byUser['artist']).toBe(7n);
    expect(sum(r.beneficiaries.map((b) => b.amount))).toBe(50n);
    expect(r.platformCut).toBe(50n);
  });

  it('shares summing < 100%: unallocated pool falls to owner', () => {
    // pool 50; writer 40% → 20; remainder 30 → owner.
    const r = computeRevenueSplit({
      totalAmount: 100n,
      shareBps: 5000,
      ownerUserId: OWNER,
      contributors: [{ userId: 'writer', shareBps: 4000 }],
    });
    const byUser = Object.fromEntries(
      r.beneficiaries.map((b) => [b.userId, b.amount]),
    );
    expect(byUser['writer']).toBe(20n);
    expect(byUser[OWNER]).toBe(30n);
    expect(r.platformCut).toBe(50n);
  });

  it('never over-allocates when shares exceed 100% (defensive cap)', () => {
    // Two contributors each 8000bps would be 160% of the pool — must cap at pool.
    const r = computeRevenueSplit({
      totalAmount: 100n,
      shareBps: 10000,
      ownerUserId: OWNER,
      contributors: [
        { userId: 'a', shareBps: 8000 },
        { userId: 'b', shareBps: 8000 },
      ],
    });
    expect(sum(r.beneficiaries.map((b) => b.amount))).toBe(100n);
    expect(r.platformCut).toBe(0n);
  });

  it('zero pool (0% share) → no beneficiaries, platform keeps all', () => {
    const r = computeRevenueSplit({
      totalAmount: 100n,
      shareBps: 0,
      ownerUserId: OWNER,
      contributors: [{ userId: 'writer', shareBps: 5000 }],
    });
    expect(r.beneficiaries).toEqual([]);
    expect(r.platformCut).toBe(100n);
  });

  it('dedupes duplicate contributor userIds by summing bps', () => {
    // writer listed twice (3000 + 3000 = 6000); pool 50 → writer 30, owner 20.
    const r = computeRevenueSplit({
      totalAmount: 100n,
      shareBps: 5000,
      ownerUserId: OWNER,
      contributors: [
        { userId: 'writer', shareBps: 3000 },
        { userId: 'writer', shareBps: 3000 },
      ],
    });
    const byUser = Object.fromEntries(
      r.beneficiaries.map((b) => [b.userId, b.amount]),
    );
    expect(byUser['writer']).toBe(30n);
    expect(byUser[OWNER]).toBe(20n);
    expect(r.platformCut).toBe(50n);
  });

  it('tiny pool smaller than headcount: rounding sweeps to owner, no zero rows', () => {
    // total 3, share 5000 → pool 1. writer 50% → floor(0.5)=0 (dropped). owner gets 1.
    const r = computeRevenueSplit({
      totalAmount: 3n,
      shareBps: 5000,
      ownerUserId: OWNER,
      contributors: [{ userId: 'writer', shareBps: 5000 }],
    });
    expect(r.beneficiaries.every((b) => b.amount > 0n)).toBe(true);
    const byUser = Object.fromEntries(
      r.beneficiaries.map((b) => [b.userId, b.amount]),
    );
    expect(byUser[OWNER]).toBe(1n);
    expect(byUser['writer']).toBeUndefined();
    expect(r.platformCut + sum(r.beneficiaries.map((b) => b.amount))).toBe(3n);
  });
});
