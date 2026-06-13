import { z } from 'zod';

/**
 * DTOs for the legacy (Java) points admin ops.
 *
 * "Legacy points" = `client_user.score_balance` in the Java
 * `fizzdragon_client` MySQL — the balance the old AI image/video gen
 * still deducts from. We reach it through the LegacyMysql bridge, not
 * Prisma. Kept deliberately small: identify a user, grant/deduct a
 * delta, read recent ledger rows.
 */

/** A phone OR email string identifying the target user. */
const Identifier = z.string().trim().min(1, 'identifier required').max(255);

export const GrantLegacyPointsSchema = z.object({
  /** Phone or email of the target `client_user`. */
  identifier: Identifier,
  /**
   * Signed delta. Positive grants, negative deducts. Non-zero. Capped
   * to a sane range so a fat-fingered grant can't mint millions.
   */
  score: z.coerce
    .number()
    .int('score must be an integer')
    .refine((v) => v !== 0, 'score cannot be zero')
    .refine((v) => Math.abs(v) <= 1_000_000, 'score magnitude too large'),
  /** Free-form audit note stored on the ledger row (remark). */
  note: z.string().trim().max(500).optional(),
});
export type GrantLegacyPointsInput = z.infer<typeof GrantLegacyPointsSchema>;

export const LegacyUserParamsSchema = z.object({
  identifier: Identifier,
});
export type LegacyUserParams = z.infer<typeof LegacyUserParamsSchema>;

export const ListLegacyRecordsQuerySchema = z.object({
  identifier: Identifier,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListLegacyRecordsQuery = z.infer<
  typeof ListLegacyRecordsQuerySchema
>;

export const SearchMembersQuerySchema = z.object({
  /** Fuzzy match against phone / email / nickname / id. Empty = list all. */
  query: z.string().trim().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchMembersQuery = z.infer<typeof SearchMembersQuerySchema>;

export const ListLegacyLedgerQuerySchema = z.object({
  /** Fuzzy phone/email/nickname/id match on the OWNING user (LIKE %q%). Empty = all users. */
  query: z.string().trim().max(255).optional(),
  /** record_type filter: 1=充值 2=消费 3=系统赠送. Coerced from the query string. */
  recordType: z.coerce
    .number()
    .int()
    .refine((v) => v === 1 || v === 2 || v === 3, 'recordType must be 1|2|3')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListLegacyLedgerQuery = z.infer<typeof ListLegacyLedgerQuerySchema>;
