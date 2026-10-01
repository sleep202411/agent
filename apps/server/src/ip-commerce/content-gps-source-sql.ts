import { Prisma } from '@prisma/client';

// ECMAScript trim whitespace: keep SQL's source inclusion exactly aligned with
// snapshotIn(), including tabs, BOM and non-breaking spaces. Text is not trimmed
// in the actual snapshot because evidence uses exact UTF-16 offsets.
const trimWhitespace =
  '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

/** A correlated SQL expression for alias `ip`. Internal only: source text must
 * never be returned in search cards, markers, counts or recommendation reasons. */
export function contentGpsSourceSnapshotSql(locale: string): Prisma.Sql {
  return Prisma.sql`(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', source.id::text || ':' || field.name,
      'sourceType', source.kind,
      'sourceId', source.id::text,
      'sourceVersion', to_char(source.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'locator', field.name,
      'visibilityAtAnalysis', 'public',
      'text', field.text
    ) ORDER BY (source.id::text || ':' || field.name) COLLATE "C"), '[]'::jsonb)
    FROM (
      SELECT l.id, l.updated_at, l.summary, l.description, 'ip_localization'::text AS kind
      FROM ip_localizations l WHERE l.ip_id = ip.id AND l.locale = ${locale}
        AND l.status::text = 'published' AND l.archived_at IS NULL
      UNION ALL
      SELECT l.id, l.updated_at, l.summary, l.description, 'episode_localization'::text
      FROM ip_episode_localizations l JOIN ip_episodes e ON e.id = l.episode_id
      WHERE e.ip_id = ip.id AND e.status::text = 'published' AND e.deleted_at IS NULL
        AND l.locale = ${locale} AND l.status::text = 'published' AND l.archived_at IS NULL
    ) source
    CROSS JOIN LATERAL (VALUES ('summary', source.summary), ('description', source.description)) field(name, text)
    WHERE field.text IS NOT NULL AND btrim(field.text, ${trimWhitespace}) <> ''
  )`;
}
