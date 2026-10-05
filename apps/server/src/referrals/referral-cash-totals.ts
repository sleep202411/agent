import { Prisma } from '@prisma/client';

/** Sum snapshots, not the reward's primary-item compatibility columns. */
export function referralCashTotalsQuery(userId: string) {
  return Prisma.sql`
    SELECT reward.status::text AS status, cash.currency,
           SUM(cash.amount_minor)::text AS amount
    FROM referral_rewards reward
    JOIN LATERAL (
      SELECT item.currency, item.amount_minor
      FROM referral_reward_items item
      WHERE item.reward_id = reward.id AND item.payout_type = 'cash'
      UNION ALL
      SELECT reward.currency, reward.amount_minor
      WHERE reward.payout_type = 'cash'
        AND NOT EXISTS (
          SELECT 1 FROM referral_reward_items item WHERE item.reward_id = reward.id
        )
    ) cash ON true
    WHERE reward.user_id = ${userId}
    GROUP BY reward.status, cash.currency
    ORDER BY cash.currency, reward.status
  `;
}

export interface ReferralCashTotalRow {
  status: string;
  currency: string | null;
  amount: string;
}
