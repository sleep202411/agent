import { contentGpsGeocodedMetadataSql } from './content-gps-geocode-sql';
import { Prisma } from '@prisma/client';
import type { ContentGpsSearchRequest } from '@repo/shared/content-gps';
import { contentGpsSourceSnapshotSql } from './content-gps-source-sql';

/** Set-based read: all matching and map aggregation precede card pagination.
 * Permission predicates come from the existing catalogue, never the GPS index. */
export function contentGpsSearchSql(
  input: ContentGpsSearchRequest,
  filters: { accessible: Prisma.Sql; matching: Prisma.Sql },
  analysisVersion: string | null,
) {
  const { query, map } = input;
  const location = query.location;
  const placeMatch = location
    ? Prisma.sql`(
    SELECT count(DISTINCT p.value->>'placeId') FROM jsonb_array_elements(locations) p(value)
    WHERE p.value->>'kind' = ${location.kind}
      AND p.value->>'placeId' IN (${Prisma.join(location.placeIds)})
  ) >= ${location.relation === 'all' ? new Set(location.placeIds).size : 1}`
    : Prisma.sql`TRUE`;
  const era = query.era;
  const eraMatch = era
    ? Prisma.sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements(eras) era(value)
    WHERE ${
      era.relation === 'overlaps'
        ? Prisma.sql`(era.value->>'startYear')::bigint <= ${era.endYear} AND (era.value->>'endYear')::bigint >= ${era.startYear}`
        : Prisma.sql`(era.value->>'startYear')::bigint >= ${era.startYear} AND (era.value->>'endYear')::bigint <= ${era.endYear}`
    }
  )`
    : Prisma.sql`TRUE`;
  const duration = query.duration;
  const durationMatch = duration
    ? Prisma.sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements(episodes) episode(value)
    WHERE (episode.value->>'durationSeconds')::int <= ${duration.maxSeconds}
      ${duration.unknown === 'include_labelled' ? Prisma.sql`OR episode.value->>'durationSeconds' IS NULL` : Prisma.empty}
  )`
    : Prisma.sql`TRUE`;
  const card = Prisma.sql`jsonb_build_object('id', e.id, 'creatorId', e.created_by_id, 'title', e.title,
    'locations', e.locations, 'locationSource', e.location_source, 'eras', e.eras, 'matched', e.matched,
    'episode', (SELECT episode.value FROM jsonb_array_elements(e.episodes) episode(value)
      ${
        duration
          ? Prisma.sql`WHERE (episode.value->>'durationSeconds')::int <= ${duration.maxSeconds}
        ${duration.unknown === 'include_labelled' ? Prisma.sql`OR episode.value->>'durationSeconds' IS NULL` : Prisma.empty}`
          : Prisma.empty
      }
      ORDER BY (episode.value->>'durationSeconds')::int ASC NULLS LAST, episode.value->>'id' LIMIT 1))`;
  const width =
    map.east > map.west ? map.east - map.west : 360 - map.west + map.east;
  return Prisma.sql`
  WITH catalogue AS MATERIALIZED (
    SELECT ip.id, ip.created_by_id, display.title,
      (${filters.matching}) AS genre_match,
      ip.status::text = 'published' AND EXISTS (
        SELECT 1 FROM ip_localizations l WHERE l.ip_id = ip.id AND l.locale = ${query.locale}
          AND l.status::text = 'published' AND l.archived_at IS NULL
      ) AS source_public
    FROM ips ip
    JOIN LATERAL (
      SELECT title FROM ip_localizations l WHERE l.ip_id = ip.id AND l.locale = ${query.locale}
        AND l.status::text = 'published' AND l.archived_at IS NULL LIMIT 1
    ) display ON TRUE
    WHERE ${filters.accessible}
  ), enriched AS MATERIALIZED (
    SELECT c.*, COALESCE(owner.locations, analysis.metadata->'locations', '[]'::jsonb) AS raw_locations,
      CASE WHEN owner.version IS NOT NULL THEN 'owner' WHEN analysis.metadata IS NOT NULL THEN 'analysis' ELSE 'unknown' END AS location_source,
      COALESCE(analysis.metadata->'eras', '[]'::jsonb) AS raw_eras,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'durationSeconds', e.duration_seconds) ORDER BY e.id)
        FROM ip_episodes e WHERE e.ip_id = c.id AND e.status::text = 'published' AND e.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM ip_episode_localizations l WHERE l.episode_id = e.id AND l.locale = ${query.locale}
            AND l.status::text = 'published' AND l.archived_at IS NULL)), '[]'::jsonb) AS episodes
    FROM catalogue c
    JOIN ips ip ON ip.id = c.id
    LEFT JOIN LATERAL (
      SELECT locations, version FROM ip_content_gps_location_revisions r WHERE r.ip_id = c.id ORDER BY version DESC LIMIT 1
    ) owner ON TRUE
    LEFT JOIN LATERAL (
      SELECT ${contentGpsGeocodedMetadataSql(Prisma.sql`a`)} AS metadata FROM ip_content_gps_analyses a
      WHERE c.source_public AND a.ip_id = c.id AND a.locale = ${query.locale}
        AND a.analysis_version = ${analysisVersion}
        AND a.source_snapshot = ${contentGpsSourceSnapshotSql(query.locale)}
      ORDER BY a.created_at DESC LIMIT 1
    ) analysis ON TRUE
  ), projected AS MATERIALIZED (
    SELECT id, created_by_id, title, genre_match, episodes, location_source,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', l.value->>'id', 'placeId', 'label:' || lower(btrim(l.value->>'label')),
        'kind', l.value->>'kind', 'label', l.value->>'label', 'status', l.value->>'status',
        'point', l.value->'point') ORDER BY l.value->>'id')
        FROM jsonb_array_elements(raw_locations) l(value)), '[]'::jsonb) AS locations,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('startYear', e.value->'startYear', 'endYear', e.value->'endYear',
        'calendar', e.value->>'calendar')) FROM jsonb_array_elements(raw_eras) e(value)), '[]'::jsonb) AS eras
    FROM enriched
  ), evaluated AS MATERIALIZED (
    SELECT *, (genre_match AND ${placeMatch} AND ${eraMatch} AND ${durationMatch}) AS matched FROM projected
  ), candidates AS (
    SELECT * FROM evaluated WHERE matched ${input.cursor ? Prisma.sql`AND id > ${input.cursor.afterId}::uuid` : Prisma.empty}
    ORDER BY id LIMIT ${input.limit + 1}
  ), page AS (
    SELECT * FROM candidates ORDER BY id LIMIT ${input.limit}
  ), points AS (
    SELECT DISTINCT e.id, e.matched, (l.value->'point'->>'longitude')::double precision AS longitude,
      (l.value->'point'->>'latitude')::double precision AS latitude
    FROM evaluated e CROSS JOIN LATERAL jsonb_array_elements(e.locations) l(value)
    WHERE l.value->>'status' = 'resolved'
      AND l.value->'point'->>'coordinateSystem' = ${map.coordinateSystem}
  ), visible_points AS (
    SELECT *, CASE WHEN longitude < ${map.west} THEN longitude + 360 ELSE longitude END - ${map.west} AS dx
    FROM points WHERE latitude BETWEEN ${map.south} AND ${map.north}
      AND ${map.east > map.west ? Prisma.sql`longitude BETWEEN ${map.west} AND ${map.east}` : Prisma.sql`(longitude >= ${map.west} OR longitude <= ${map.east})`}
  ), clusters AS (
    SELECT least(19, floor(dx / ${width} * 20)) AS x,
      least(9, floor((latitude - ${map.south}) / ${map.north - map.south} * 10)) AS y,
      matched, count(*)::int AS point_count, count(DISTINCT id)::int AS ip_count,
      CASE WHEN count(DISTINCT id) = 1 THEN min(id::text) ELSE NULL END AS ip_id,
      avg(latitude) AS latitude, avg(dx) + ${map.west} AS longitude
    FROM visible_points GROUP BY x, y, matched
  ), places AS MATERIALIZED (
    SELECT l.value->>'placeId' AS id, l.value->>'kind' AS kind,
      min(l.value->>'label') AS label, count(DISTINCT e.id)::int AS ip_count
    FROM evaluated e CROSS JOIN LATERAL jsonb_array_elements(e.locations) l(value)
    WHERE position(lower(${input.placeSearch}) in lower(l.value->>'label')) > 0
    GROUP BY l.value->>'placeId', l.value->>'kind'
  )
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(${card} ORDER BY e.id) FROM page e), '[]'::jsonb),
    'selected', (SELECT ${card} FROM evaluated e WHERE e.id = ${input.selectedIpId}::uuid),
    'matchedCount', (SELECT count(*) FROM evaluated WHERE matched),
    'accessibleCount', (SELECT count(*) FROM evaluated),
    'nextId', CASE WHEN (SELECT count(*) FROM candidates) > ${input.limit} THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END,
    'places', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'label', p.label, 'ipCount', p.ip_count) ORDER BY p.id, p.kind)
      FROM (SELECT * FROM places ORDER BY id, kind LIMIT 500) p), '[]'::jsonb),
    'placeCount', (SELECT count(*) FROM places),
    'placesTruncated', (SELECT count(*) > 500 FROM places),
    'mapIpCount', (SELECT count(DISTINCT id) FROM visible_points),
    'mapMatchedIpCount', (SELECT count(DISTINCT id) FROM visible_points WHERE matched),
    'clusters', COALESCE((SELECT jsonb_agg(jsonb_build_object('cell', x::text || ':' || y::text, 'matched', matched,
      'pointCount', point_count, 'ipCount', ip_count, 'ipId', ip_id, 'latitude', latitude,
      'longitude', CASE WHEN longitude > 180 THEN longitude - 360 ELSE longitude END) ORDER BY x, y, matched) FROM clusters), '[]'::jsonb)
  ) AS result`;
}
