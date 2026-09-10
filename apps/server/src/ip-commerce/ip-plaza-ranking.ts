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
  version: z.literal(2),
  id: z.string().uuid(),
  hasVideo: z.boolean(),
  score: RankKeySchema,
  published: RankKeySchema,
  created: RankKeySchema,
});

export type PublicIpRankRow = Omit<z.infer<typeof CursorSchema>, 'version'>;

export function encodePublicIpRankCursor(row: PublicIpRankRow): string {
  return Buffer.from(JSON.stringify({ version: 2, ...row })).toString(
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
        AND (ranked."hasVideo", ranked.score, ranked.published, ranked.created, ranked.id) < (
        ${cursor.hasVideo}::boolean, ${cursor.score}::bigint, ${cursor.published}::bigint,
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
        -- Match the public list's playback access: promotional trailers, free
        -- episodes and free previews. A private/unfinished video isn't a TV channel.
        EXISTS (
          SELECT 1
          FROM (
            SELECT ip.trailer_asset_id AS asset_id
            UNION ALL
            SELECT episode.trailer_asset_id
            FROM ip_episodes episode
            WHERE episode.ip_id = ip.id AND episode.deleted_at IS NULL
              AND episode.status::text IN ('scheduled', 'published')
            UNION ALL
            SELECT episode.media_asset_id
            FROM ip_episodes episode
            WHERE episode.ip_id = ip.id AND episode.deleted_at IS NULL
              AND episode.status::text IN ('scheduled', 'published')
              AND (
                episode.is_free_preview
                OR NOT EXISTS (
                  SELECT 1 FROM ip_price_rules price
                  WHERE price.ip_id = ip.id
                    AND (price.target_type::text = 'ip' OR price.episode_id = episode.id)
                    AND price.status::text = 'active' AND price.archived_at IS NULL
                    AND price.currency::text = 'community_point'
                    AND (price.starts_at IS NULL OR price.starts_at <= CURRENT_TIMESTAMP)
                    AND (price.ends_at IS NULL OR price.ends_at > CURRENT_TIMESTAMP)
                )
              )
          ) candidate
          JOIN media_assets video ON video.id = candidate.asset_id
          WHERE video.kind::text = 'video' AND video.status::text = 'ready'
            AND video.deleted_at IS NULL AND video.moderation_status::text <> 'blocked'
            AND (
              (video.storage_provider::text = 'external_url' AND NULLIF(video.external_url, '') IS NOT NULL)
              OR (video.storage_provider::text <> 'external_url'
                AND NULLIF(video.bucket, '') IS NOT NULL AND NULLIF(video.object_key, '') IS NOT NULL)
            )
        ) AS "hasVideo",
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
    SELECT ranked.id::text, ranked."hasVideo", ranked.score::text, ranked.published::text, ranked.created::text
    FROM ranked
    ${seek}
    ORDER BY ranked."hasVideo" DESC, ranked.score DESC, ranked.published DESC, ranked.created DESC, ranked.id DESC
    LIMIT ${limit + 1}
  `;
}
