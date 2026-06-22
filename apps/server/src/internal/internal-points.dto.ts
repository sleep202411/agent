import { z } from 'zod';

const userId = z.string().trim().min(1).max(64);
const idempotencyKey = z.string().trim().min(1).max(180);
const reason = z.string().trim().max(500).optional();

/** Ingest a user's current Java balance into the PG wallet. Idempotent per user.
 *  `balance` may be negative — a legacy overdrawn balance is carried as a debt
 *  (the wallet goes negative; the next recharge/grant pays it down first). */
export const MigratePointsSchema = z.object({
  userId,
  balance: z.coerce.number().int(),
});
export type MigratePointsInput = z.infer<typeof MigratePointsSchema>;

/** Deduct points from a migrated user's PG wallet (direct spend, no hold). */
export const DeductPointsSchema = z.object({
  userId,
  amount: z.coerce.number().int().min(1),
  reason,
  idempotencyKey,
});
export type DeductPointsInput = z.infer<typeof DeductPointsSchema>;

/** Grant points to a migrated user's PG wallet (bonuses/refunds post-migration). */
export const GrantPointsSchema = z.object({
  userId,
  amount: z.coerce.number().int().min(1),
  reason,
  idempotencyKey,
});
export type GrantPointsInput = z.infer<typeof GrantPointsSchema>;

export const PointsBalanceQuerySchema = z.object({ userId });
export type PointsBalanceQuery = z.infer<typeof PointsBalanceQuerySchema>;
