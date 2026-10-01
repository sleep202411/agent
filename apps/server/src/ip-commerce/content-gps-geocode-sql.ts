import { Prisma } from '@prisma/client';

/** The analysis row must already pass current-source and visibility checks.
 * Enrichment never replaces owner revisions. Expired payloads are not read. */
export function contentGpsGeocodedMetadataSql(analysis: Prisma.Sql) {
  return Prisma.sql`jsonb_set(${analysis}.metadata, '{locations}', COALESCE((
    SELECT jsonb_agg(CASE WHEN g.result IS NOT NULL THEN
      l.value || jsonb_build_object('status', g.result->'status', 'point', g.result->'point')
      ELSE l.value END ORDER BY l.ordinality)
    FROM jsonb_array_elements(${analysis}.metadata->'locations') WITH ORDINALITY l(value, ordinality)
    LEFT JOIN LATERAL (
      SELECT result FROM ip_content_gps_geocodes g
      WHERE g.ip_id = ${analysis}.ip_id AND g.locale = ${analysis}.locale
        AND g.source_fingerprint = ${analysis}.source_fingerprint AND g.analysis_version = ${analysis}.analysis_version
        AND g.location_id = l.value->>'id' AND g.status = 'completed' AND g.expires_at > now()
        AND l.value->>'status' <> 'fictional'
      ORDER BY g.created_at DESC, g.id DESC LIMIT 1
    ) g ON TRUE
  ), '[]'::jsonb))`;
}
