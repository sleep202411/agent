/**
 * Validity policy for compute_point credit grants (积分有效期). Decided 2026-06-20:
 *
 *   - Promotional / free credits (check-in, campaign, voucher, referral,
 *     registration bonus) expire `PROMO_CREDIT_VALIDITY_DAYS` after grant.
 *   - Membership-included credits expire at the billing period end (set by the
 *     membership fulfillment to period.endsAt — NOT here).
 *   - Paid top-ups and migrated legacy balances never expire (expiresAt = null).
 *   - Admin / system grants never expire unless an expiry is passed explicitly.
 *
 * Enforcement is in WalletLedgerService: the spend path already refuses expired
 * grants, and `expireLapsedGrants` sweeps lapsed grants out of the balance.
 */
export const PROMO_CREDIT_VALIDITY_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** Expiry for a promotional credit grant: `from` + the promo validity window. */
export function promoCreditExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + PROMO_CREDIT_VALIDITY_DAYS * MS_PER_DAY);
}
