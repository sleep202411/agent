/**
 * Pure, deterministic creator-revenue split for an IP sale. No Prisma, no I/O —
 * fully unit-testable. Two layers:
 *
 *   1. platform vs creator: `creatorPool = floor(totalAmount * shareBps / 10000)`,
 *      the platform keeps the remainder.
 *   2. creator pool across contributors: each eligible contributor takes
 *      `floor(creatorPool * contributorBps / 10000)`; any unallocated pool
 *      (shares summing < 100%) plus the integer rounding remainder goes to the
 *      IP owner. Owner-only is the degenerate case (no eligible contributors).
 *
 * Invariant: `platformCut + Σ(beneficiary.amount) === totalAmount`, exactly, so
 * no community point is created or lost.
 */

export interface RevenueSplitContributor {
  userId: string;
  /** Configured share of the creator pool, in basis points (0..10000). */
  shareBps: number | null | undefined;
}

export interface RevenueSplitBeneficiary {
  userId: string;
  amount: bigint;
  /** Effective share of the creator pool actually received, in basis points. */
  shareBps: number;
}

export interface RevenueSplitResult {
  creatorPool: bigint;
  platformCut: bigint;
  beneficiaries: RevenueSplitBeneficiary[];
}

const BPS_DENOM = 10000n;

export function clampBps(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const v = Math.trunc(value);
  if (v < 0) return 0;
  if (v > 10000) return 10000;
  return v;
}

/**
 * Community-member discount on a points-priced amount. Floor semantics match the
 * revenue split (`discount = floor(amount * bps / 10000)`), so the charged amount
 * is always an integer in `[0, amount]`. bps is clamped to 0..10000 (0 = no
 * discount, 10000 = free). The list `amount` is unchanged by the caller — this is
 * the single source of the *charged* number.
 */
export function applyMemberDiscount(amount: bigint, bps: number): bigint {
  if (amount <= 0n) return 0n;
  const clamped = clampBps(bps);
  if (clamped <= 0) return amount;
  const discount = (amount * BigInt(clamped)) / BPS_DENOM;
  return amount - discount;
}

export function computeRevenueSplit(input: {
  totalAmount: bigint;
  shareBps: number;
  ownerUserId: string;
  contributors: RevenueSplitContributor[];
}): RevenueSplitResult {
  const total = input.totalAmount > 0n ? input.totalAmount : 0n;
  const shareBps = clampBps(input.shareBps);
  const creatorPool = (total * BigInt(shareBps)) / BPS_DENOM;

  if (creatorPool <= 0n) {
    return { creatorPool: 0n, platformCut: total, beneficiaries: [] };
  }

  // Dedupe eligible contributors by userId, summing their configured bps (then
  // re-clamp so a duplicate-inflated sum can't exceed 100%).
  const merged = new Map<string, number>();
  for (const c of input.contributors) {
    if (!c.userId) continue;
    const bps = clampBps(c.shareBps);
    if (bps <= 0) continue;
    merged.set(c.userId, clampBps((merged.get(c.userId) ?? 0) + bps));
  }

  // Allocate in deterministic (sorted) userId order so wallet lock acquisition
  // is stable across concurrent sales and the running total never exceeds pool.
  const amounts = new Map<string, bigint>();
  let allocated = 0n;
  for (const userId of [...merged.keys()].sort()) {
    const bps = merged.get(userId) ?? 0;
    let amount = (creatorPool * BigInt(bps)) / BPS_DENOM;
    if (allocated + amount > creatorPool) amount = creatorPool - allocated;
    if (amount <= 0n) continue;
    amounts.set(userId, amount);
    allocated += amount;
  }

  // Unallocated pool (shares < 100%) + rounding remainder → the IP owner. This
  // also covers owner-only (no eligible contributors → owner takes the pool).
  const remainder = creatorPool - allocated;
  if (remainder > 0n && input.ownerUserId) {
    amounts.set(
      input.ownerUserId,
      (amounts.get(input.ownerUserId) ?? 0n) + remainder,
    );
  }

  const beneficiaries: RevenueSplitBeneficiary[] = [...amounts.entries()]
    .filter(([, amount]) => amount > 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([userId, amount]) => ({
      userId,
      amount,
      shareBps: Number((amount * BPS_DENOM) / creatorPool),
    }));

  const platformCut =
    total - beneficiaries.reduce((sum, b) => sum + b.amount, 0n);

  return { creatorPool, platformCut, beneficiaries };
}
