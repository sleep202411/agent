/**
 * Pure helper for carrying a migrated legacy debt in the grant-backed wallet.
 * No Prisma / I/O — unit-tested.
 */

/**
 * Split a credit landing on a possibly-overdrawn account into the portion that
 * pays down the existing debt vs the portion that becomes spendable.
 *
 * The compute_point wallet is grant-backed (`availableBalance == Σ active grant
 * remainders` whenever it's ≥ 0). A migrated negative balance has no backing
 * grant, so a later credit must book the debt-paydown portion as already-consumed
 * — only the NET addition counts as the grant's `availableAmount`. That keeps the
 * invariant (and FIFO consume + expiry) correct, with no debt double-count.
 *
 * `preBalance < 0` is the outstanding debt. Returns how much of `creditAmount`
 * settles it and how much remains spendable.
 * Invariant: `debtSettled + availableAmount === creditAmount`, both ≥ 0.
 */
export function settleMigratedDebt(
  preBalance: bigint,
  creditAmount: bigint,
): { debtSettled: bigint; availableAmount: bigint } {
  const debt = preBalance < 0n ? -preBalance : 0n;
  const debtSettled = creditAmount < debt ? creditAmount : debt;
  return { debtSettled, availableAmount: creditAmount - debtSettled };
}
