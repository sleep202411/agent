/**
 * Pure helpers for the community-member revenue pool (view weighting + monthly
 * settlement). No Prisma, no I/O — fully unit-testable. Shared by the view signal
 * (Phase 4) and the pool settlement (Phase 5) so both bucket a month identically.
 */

/**
 * Settlement period key for a timestamp: `YYYY-MM` in **UTC**. Stamped on each
 * MemberViewEvent at write time and used to group a month's views for settlement.
 * UTC (not a business timezone) keeps the bucket deterministic across regions and
 * lets the settlement read back the exact same key. (A business-TZ cutover is a
 * deliberate future change, not an accident of local time.)
 */
export function formatSettlementPeriod(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
