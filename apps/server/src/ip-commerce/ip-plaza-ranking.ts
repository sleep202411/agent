import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const ENGAGEMENT_WEIGHTS = { view: 1, like: 5, collection: 8 } as const;
const INITIAL_SCORE = 10;
const HALF_LIFE_MICROS = 7 * 24 * 60 * 60 * 1_000_000;

// Keep PostgreSQL's microsecond precision through JSON and pagination.
const RankKeySchema = z
  .string()
  .regex(/^-?\d{1,19}$/)
  .refine((value) => {
    const key = BigInt(value);
    return key >= -9223372036854775808n && key <= 9223372036854775807n;
  });
const CursorSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  score: RankKeySchema,
  published: RankKeySchema,
  created: RankKeySchema,
});

export type PublicIpRankRow = Omit<z.infer<typeof CursorSchema>, 'version'>;

export function encodePublicIpRankCursor(row: PublicIpRankRow): string {
  return Buffer.from(JSON.stringify({ version: 1, ...row })).toString(
    'base64url',
  );
}

function decodeCursor(value: string): PublicIpRankRow {
  try {
    if (value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value)) {
      const decoded: unknown = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      );
      return CursorSchema.parse(decoded);
    }
  } catch {
    // Invalid cursors must never silently restart the first page.
  }
  throw new BadRequestException({
    code: 'IP_LIST_CURSOR_INVALID',
    msg: 'The pagination cursor is invalid. Refresh the list and try again.',
  });
}

export function publicIpRankQuery(
  filter: Prisma.Sql,
  limit: number,
  cursorValue?: string,
): Prisma.Sql {
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  const seek = cursor
    ? Prisma.sql`WHERE ranked.id <> ${cursor.id}::uuid
        AND (ranked.score, ranked.published, ranked.created, ranked.id) < (
        ${cursor.score}::bigint, ${cursor.published}::bigint,
        ${cursor.created}::bigint, ${cursor.id}::uuid
      )`
    : Prisma.empty;

  // Equivalent to (10 + views + 5*likes + 8*collections) * 2^(-ageDays/7).
  // In log space the shared "now" term cancels, so time passing between pages
  // cannot move their boundary and old entries never underflow to zero.
  // The initial score gives new, zero-engagement IPs a chance to be discovered.
  // NULL publication dates receive no recency boost; neither editing nor a
  // missing publication date makes an IP a fresh release.
  return Prisma.sql`
    WITH ranked AS (
      SELECT
        ip.id,
        ROUND(
          COALESCE(EXTRACT(EPOCH FROM ip.published_at) * 1000000, 0)
          + ${HALF_LIFE_MICROS}::numeric * LN(
            ${INITIAL_SCORE}::numeric
            + COALESCE(engagement.total_view_count, 0)::numeric * ${ENGAGEMENT_WEIGHTS.view}
            + COALESCE(engagement.total_like_count, 0)::numeric * ${ENGAGEMENT_WEIGHTS.like}
            + COALESCE(collections.collection_count, 0)::numeric * ${ENGAGEMENT_WEIGHTS.collection}
          ) / LN(2::numeric)
        )::bigint AS score,
        COALESCE(EXTRACT(EPOCH FROM ip.published_at) * 1000000, 0)::bigint AS published,
        (EXTRACT(EPOCH FROM ip.created_at) * 1000000)::bigint AS created
      FROM ips ip
      LEFT JOIN ip_engagement_aggregates engagement ON engagement.ip_id = ip.id
      LEFT JOIN (
        SELECT ip_id, COUNT(*) AS collection_count
        FROM ip_collection_items
        WHERE target_type::text = 'ip'
          AND status::text = 'active'
          AND removed_at IS NULL
        GROUP BY ip_id
      ) collections ON collections.ip_id = ip.id
      WHERE ${filter}
    )
    SELECT ranked.id::text, ranked.score::text, ranked.published::text, ranked.created::text
    FROM ranked
    ${seek}
    ORDER BY ranked.score DESC, ranked.published DESC, ranked.created DESC, ranked.id DESC
    LIMIT ${limit + 1}
  `;
}
