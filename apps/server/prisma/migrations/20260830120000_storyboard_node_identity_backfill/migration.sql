-- Complete the Plot node <-> Storyboard one-to-one migration before the new
-- application starts. This migration is deliberately fail-closed: it repairs
-- only the unambiguous legacy shape (a chapter-owned Plot node with no active
-- timeline) and aborts on every ownership/identity conflict.
BEGIN;

LOCK TABLE "story_drafts", "story_chapters", "story_storyboard_sequences"
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "story_storyboard_sequences"
    WHERE "status" <> 'archived'
    GROUP BY "story_project_id", "plot_node_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Storyboard identity backfill stopped: a Plot node has multiple active timelines'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    WITH graph_nodes AS (
      SELECT
        draft."story_project_id",
        node.value ->> 'nodeId' AS "node_id",
        node.value ->> 'kind' AS "node_kind"
      FROM "story_drafts" draft
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(draft."content" -> 'graph' -> 'nodes', '[]'::jsonb)
      ) AS node(value)
    )
    SELECT 1
    FROM graph_nodes
    GROUP BY "story_project_id", "node_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Storyboard identity backfill stopped: a Story draft contains duplicate graph node ids'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "story_storyboard_sequences" sequence
    WHERE sequence."status" <> 'archived'
      AND NOT EXISTS (
        SELECT 1
        FROM "story_drafts" draft
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(draft."content" -> 'graph' -> 'nodes', '[]'::jsonb)
        ) AS node(value)
        WHERE draft."story_project_id" = sequence."story_project_id"
          AND node.value ->> 'nodeId' = sequence."plot_node_id"
      )
  ) THEN
    RAISE EXCEPTION 'Storyboard identity backfill stopped: an active timeline has no Plot node'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "story_storyboard_sequences" sequence
    JOIN "story_drafts" draft
      ON draft."story_project_id" = sequence."story_project_id"
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(draft."content" -> 'graph' -> 'nodes', '[]'::jsonb)
    ) AS node(value)
    WHERE sequence."status" <> 'archived'
      AND node.value ->> 'nodeId' = sequence."plot_node_id"
      AND node.value ->> 'kind' <> 'clip'
  ) THEN
    RAISE EXCEPTION 'Storyboard identity backfill stopped: a timeline collides with a non-Plot graph node'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH plot_nodes AS (
      SELECT
        draft."story_project_id",
        node.value ->> 'nodeId' AS "plot_node_id"
      FROM "story_drafts" draft
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(draft."content" -> 'graph' -> 'nodes', '[]'::jsonb)
      ) AS node(value)
      WHERE node.value ->> 'kind' = 'clip'
    )
    SELECT 1
    FROM plot_nodes plot
    LEFT JOIN "story_chapters" chapter
      ON chapter."story_project_id" = plot."story_project_id"
      AND chapter."archived_at" IS NULL
      AND chapter."node_ids" ? plot."plot_node_id"
    GROUP BY plot."story_project_id", plot."plot_node_id"
    HAVING count(chapter."id") <> 1
  ) THEN
    RAISE EXCEPTION 'Storyboard identity backfill stopped: a Plot node does not have exactly one active chapter owner'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "story_storyboard_sequences" sequence
    JOIN "story_chapters" owner
      ON owner."story_project_id" = sequence."story_project_id"
      AND owner."archived_at" IS NULL
      AND owner."node_ids" ? sequence."plot_node_id"
    WHERE sequence."status" <> 'archived'
      AND sequence."story_chapter_id" <> owner."id"
  ) THEN
    RAISE EXCEPTION 'Storyboard identity backfill stopped: a timeline belongs to a different chapter than its Plot node'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH missing_timelines AS (
      SELECT
        draft."story_project_id",
        chapter."id" AS "story_chapter_id",
        node.value ->> 'nodeId' AS "plot_node_id"
      FROM "story_drafts" draft
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(draft."content" -> 'graph' -> 'nodes', '[]'::jsonb)
      ) AS node(value)
      JOIN "story_chapters" chapter
        ON chapter."story_project_id" = draft."story_project_id"
        AND chapter."archived_at" IS NULL
        AND chapter."node_ids" ? (node.value ->> 'nodeId')
      WHERE node.value ->> 'kind' = 'clip'
        AND NOT EXISTS (
          SELECT 1
          FROM "story_storyboard_sequences" existing
          WHERE existing."story_project_id" = draft."story_project_id"
            AND existing."plot_node_id" = node.value ->> 'nodeId'
            AND existing."status" <> 'archived'
        )
    )
    SELECT 1
    FROM missing_timelines missing
    JOIN "story_storyboard_sequences" collision
      ON collision."story_chapter_id" = missing."story_chapter_id"
      AND collision."stable_key" = missing."plot_node_id"
  ) THEN
    RAISE EXCEPTION 'Storyboard identity backfill stopped: an empty timeline stable key would collide with legacy data'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE FUNCTION "storyboard_identity_migration_canonical_json"(value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  result TEXT;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(
        string_agg(
          to_json(key)::text || ':' || "storyboard_identity_migration_canonical_json"(val),
          ',' ORDER BY key
        ),
        ''
      ) || '}'
      INTO result
      FROM jsonb_each(value) AS entry(key, val);
    WHEN 'array' THEN
      SELECT '[' || COALESCE(
        string_agg(
          "storyboard_identity_migration_canonical_json"(val),
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

WITH missing_timelines AS (
  SELECT
    draft."story_project_id",
    chapter."id" AS "story_chapter_id",
    node.value ->> 'nodeId' AS "plot_node_id",
    draft."updated_by_user_id" AS "created_by_user_id"
  FROM "story_drafts" draft
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(draft."content" -> 'graph' -> 'nodes', '[]'::jsonb)
  ) AS node(value)
  JOIN "story_chapters" chapter
    ON chapter."story_project_id" = draft."story_project_id"
    AND chapter."archived_at" IS NULL
    AND chapter."node_ids" ? (node.value ->> 'nodeId')
  WHERE node.value ->> 'kind' = 'clip'
    AND NOT EXISTS (
      SELECT 1
      FROM "story_storyboard_sequences" existing
      WHERE existing."story_project_id" = draft."story_project_id"
        AND existing."plot_node_id" = node.value ->> 'nodeId'
        AND existing."status" <> 'archived'
    )
)
INSERT INTO "story_storyboard_sequences" (
  "id",
  "story_project_id",
  "story_chapter_id",
  "plot_node_id",
  "stable_key",
  "title",
  "description",
  "suggested_duration_ms",
  "duration_ms",
  "source_fingerprint",
  "plan_disposition",
  "created_by_user_id"
)
SELECT
  gen_random_uuid(),
  missing."story_project_id",
  missing."story_chapter_id",
  missing."plot_node_id",
  missing."plot_node_id",
  NULL,
  NULL,
  0,
  0,
  encode(
    digest(
      "storyboard_identity_migration_canonical_json"(
        jsonb_build_object(
          'kind', 'empty-storyboard-timeline',
          'storyProjectId', missing."story_project_id",
          'plotNodeId', missing."plot_node_id"
        )
      ),
      'sha256'
    ),
    'hex'
  ),
  'user_override',
  missing."created_by_user_id"
FROM missing_timelines missing;

DROP FUNCTION "storyboard_identity_migration_canonical_json"(JSONB);

DO $$
BEGIN
  IF EXISTS (
    WITH plot_nodes AS (
      SELECT
        draft."story_project_id",
        node.value ->> 'nodeId' AS "plot_node_id"
      FROM "story_drafts" draft
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(draft."content" -> 'graph' -> 'nodes', '[]'::jsonb)
      ) AS node(value)
      WHERE node.value ->> 'kind' = 'clip'
    )
    SELECT 1
    FROM plot_nodes plot
    WHERE NOT EXISTS (
      SELECT 1
      FROM "story_storyboard_sequences" sequence
      WHERE sequence."story_project_id" = plot."story_project_id"
        AND sequence."plot_node_id" = plot."plot_node_id"
        AND sequence."status" <> 'archived'
    )
  ) THEN
    RAISE EXCEPTION 'Storyboard identity backfill failed to create every missing empty timeline'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Flush deferred foreign-key checks created by the backfill before replacing
-- the temporary trigger with a unique index in the same transaction.
SET CONSTRAINTS ALL IMMEDIATE;

-- The one-time backfill has removed every legacy duplicate or failed before
-- reaching this point, so a partial unique index can replace the temporary
-- forward-only trigger from the preceding migration.
DROP TRIGGER "story_storyboard_active_node_identity_guard_trigger"
  ON "story_storyboard_sequences";
DROP FUNCTION "story_storyboard_active_node_identity_guard"();

CREATE UNIQUE INDEX "story_storyboard_sequences_project_plot_active_unique_idx"
  ON "story_storyboard_sequences" ("story_project_id", "plot_node_id")
  WHERE "status" <> 'archived';

COMMIT;
