import { z } from 'zod';

const userId = z.string().trim().min(1).max(64);
// Column budget, not taste: the raw key lands in source_id VarChar(200) and the
// longest prefixed form (`community_grant:<userId≤18>:<key≤180>` = 215) must fit
// idempotency_key VarChar(240). Widen the columns BEFORE raising these caps — a
// doc-legal-but-overlong key 500s on write, and the documented same-key retry
// loops forever.
const idempotencyKey = z.string().trim().min(1).max(180);
// description column is VarChar(500).
const reason = z.string().trim().max(500).optional();

/** Ingest a user's current Java balance into the PG wallet. Idempotent per user.
 *  `balance` may be negative — a legacy overdrawn balance is FORGIVEN (the new
 *  wallet starts at 0; the original is kept in the migration marker for audit).
 *  The DB enforces non-negative wallet balances, so debt is not carried. */
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

/** Campaign community-point grant (promo codes are validated on the Java side;
 *  this only posts the credit). community_point wallets are USER-owned and read
 *  back by the same numeric Java id, so a non-numeric id would strand the
 *  credit in an account nothing ever reads — hence the strict pattern. */
export const CommunityGrantSchema = z.object({
  // Canonicalized via BigInt so "010086" and "10086" name the same wallet — a
  // leading-zero alias would otherwise mint into an account no read path sees.
  userId: z
    .string()
    .trim()
    .regex(/^\d{1,18}$/)
    .transform((v) => String(BigInt(v))),
  amount: z.coerce.number().int().min(1),
  reason,
  idempotencyKey,
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .nullish()
    .transform((v) => v ?? undefined),
});
export type CommunityGrantInput = z.infer<typeof CommunityGrantSchema>;
