-- Backfill the approved Asset-stage marker for legacy combined plans.
--
-- Before the explicit stage marker existed, current Asset/Storyboard rows (or,
-- for an intentionally empty Asset list, only Storyboard rows) plus the
-- immutable combined-plan snapshot were the durable approval proof. Recompute
-- every fingerprint exactly and update only a chapter with one unambiguous,
-- complete matching snapshot. Missing, malformed, edited, stale, archived, or
-- ambiguous legacy state deliberately remains NULL and must be reconciled by a
-- new explicit Asset approval.

CREATE FUNCTION "story_asset_marker_backfill_canonical_json"(value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  result TEXT;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(
        string_agg(
          to_json(key)::text || ':' || "story_asset_marker_backfill_canonical_json"(val),
          ',' ORDER BY key
        ),
        ''
      ) || '}'
      INTO result
      FROM jsonb_each(value) AS entry(key, val);
    WHEN 'array' THEN
      SELECT '[' || COALESCE(
        string_agg(
          "story_asset_marker_backfill_canonical_json"(val),
          ',' ORDER BY ordinality
        ),
        ''
      ) || ']'
      INTO result
      FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(val, ordinality);
    ELSE
      result := value::text;
  END CASE;
  RETURN result;
END;
$$;

WITH candidate_snapshots AS (
  SELECT
    chapter."id" AS chapter_id,
    snapshot."id" AS snapshot_id
  FROM "story_chapters" AS chapter
  INNER JOIN "story_production_plan_snapshots" AS snapshot
    ON snapshot."story_chapter_id" = chapter."id"
   AND snapshot."story_project_id" = chapter."story_project_id"
  WHERE chapter."approved_asset_plan_snapshot_id" IS NULL
    -- Refuse a snapshot whose immutable payload no longer matches its own
    -- claimed identity. Pinning it would make every later stage-state read fail
    -- as corrupt even if its surviving sequence rows happened to match.
    AND encode(
      digest(
        "story_asset_marker_backfill_canonical_json"(
          jsonb_build_object(
            'sourceFingerprint', snapshot."source_fingerprint",
            'productionPlan', snapshot."production_plan"
          )
        ),
        'sha256'
      ),
      'hex'
    ) = snapshot."plan_fingerprint"
    -- Runtime parsing is strict before it verifies the canonical hash. A raw
    -- JSON object with extra top-level metadata could be self-consistent here
    -- but become a different object after Zod strips unknown keys, so accept
    -- only the exact durable legacy combined-plan envelope.
    AND CASE
      WHEN jsonb_typeof(snapshot."production_plan") = 'object' THEN
        snapshot."production_plan" ->> 'schemaVersion' = 'story-production-plan-v1'
        AND (
          SELECT array_agg(plan_key ORDER BY plan_key)
          FROM jsonb_object_keys(snapshot."production_plan") AS keys(plan_key)
        ) = ARRAY['assetSpecs', 'schemaVersion', 'storyboardSequences']::text[]
      ELSE FALSE
    END
    AND jsonb_typeof(snapshot."production_plan" -> 'assetSpecs') = 'array'
    AND jsonb_typeof(snapshot."production_plan" -> 'storyboardSequences') = 'array'
    AND jsonb_array_length(snapshot."production_plan" -> 'storyboardSequences') > 0
    -- Every durable Asset row must still be current. Stale or archived history
    -- makes the old approval head ambiguous and therefore ineligible.
    AND NOT EXISTS (
      SELECT 1
      FROM "story_asset_specs" AS asset
      WHERE asset."story_chapter_id" = chapter."id"
        AND asset."story_project_id" = chapter."story_project_id"
        AND asset."status" <> 'current'::"StoryProductionSpecStatus"
    )
    AND (
      SELECT count(*)
      FROM "story_asset_specs" AS asset
      WHERE asset."story_chapter_id" = chapter."id"
        AND asset."story_project_id" = chapter."story_project_id"
        AND asset."status" = 'current'::"StoryProductionSpecStatus"
    ) = jsonb_array_length(snapshot."production_plan" -> 'assetSpecs')
    -- Every current Asset row must carry the exact per-item fingerprint from
    -- this snapshot; together with equal counts this is a one-to-one proof.
    AND NOT EXISTS (
      SELECT 1
      FROM "story_asset_specs" AS asset
      WHERE asset."story_chapter_id" = chapter."id"
        AND asset."story_project_id" = chapter."story_project_id"
        AND asset."status" = 'current'::"StoryProductionSpecStatus"
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            snapshot."production_plan" -> 'assetSpecs'
          ) AS item(value)
          WHERE item.value ->> 'stableKey' = asset."stable_key"
            AND encode(
              digest(
                "story_asset_marker_backfill_canonical_json"(
                  jsonb_build_object(
                    'source', snapshot."source_fingerprint",
                    'kind', 'asset',
                    'value', item.value
                  )
                ),
                'sha256'
              ),
              'hex'
            ) = asset."source_fingerprint"
        )
    )
    -- A stale/archived Storyboard cannot prove that this snapshot still owned
    -- the current production head when the marker was introduced.
    AND NOT EXISTS (
      SELECT 1
      FROM "story_storyboard_sequences" AS sequence
      WHERE sequence."story_chapter_id" = chapter."id"
        AND sequence."story_project_id" = chapter."story_project_id"
        AND sequence."status" <> 'current'::"StoryProductionSpecStatus"
    )
    AND (
      SELECT count(*)
      FROM "story_storyboard_sequences" AS sequence
      WHERE sequence."story_chapter_id" = chapter."id"
        AND sequence."story_project_id" = chapter."story_project_id"
        AND sequence."status" = 'current'::"StoryProductionSpecStatus"
    ) = jsonb_array_length(snapshot."production_plan" -> 'storyboardSequences')
    -- Every current sequence must carry the exact fingerprint that the legacy
    -- reconciler derived from this snapshot's source and complete plan item.
    AND NOT EXISTS (
      SELECT 1
      FROM "story_storyboard_sequences" AS sequence
      WHERE sequence."story_chapter_id" = chapter."id"
        AND sequence."story_project_id" = chapter."story_project_id"
        AND sequence."status" = 'current'::"StoryProductionSpecStatus"
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            snapshot."production_plan" -> 'storyboardSequences'
          ) AS item(value)
          WHERE item.value ->> 'plotNodeId' = sequence."plot_node_id"
            AND encode(
              digest(
                "story_asset_marker_backfill_canonical_json"(
                  jsonb_build_object(
                    'source', snapshot."source_fingerprint",
                    'kind', 'sequence',
                    'value', item.value
                  )
                ),
                'sha256'
              ),
              'hex'
            ) = sequence."source_fingerprint"
        )
    )
),
unambiguous_candidates AS (
  SELECT candidate.chapter_id, min(candidate.snapshot_id::text)::uuid AS snapshot_id
  FROM candidate_snapshots AS candidate
  GROUP BY candidate.chapter_id
  HAVING count(*) = 1
)
UPDATE "story_chapters" AS chapter
SET "approved_asset_plan_snapshot_id" = candidate.snapshot_id
FROM unambiguous_candidates AS candidate
WHERE chapter."id" = candidate.chapter_id
  AND chapter."approved_asset_plan_snapshot_id" IS NULL;

DROP FUNCTION "story_asset_marker_backfill_canonical_json"(JSONB);
