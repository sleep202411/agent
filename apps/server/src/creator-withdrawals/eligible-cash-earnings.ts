import { Prisma } from '@prisma/client';

/** Platform-confirmed cash only. A manually entered revenue_share is not proof
 * that FizzDragon received revenue; it must reference the immutable allocation. */
export const eligibleCashEarnings = {
  OR: [
    { sourceType: 'task_reward' },
    { sourceType: 'revenue_share', revenueDistributionId: { not: null } },
  ],
} satisfies Prisma.CrewEarningEntryWhereInput;

/** The earnings table must use alias e. Status/currency/ownership stay caller-scoped. */
export const eligibleCashEarningsSql = Prisma.sql`(
  e.source_type='task_reward' OR
  (e.source_type='revenue_share' AND e.revenue_distribution_id IS NOT NULL)
)`;
