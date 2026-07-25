-- Groups are explicit canvas objects. Legacy shot placeholders with fewer than
-- two members have no editable meaning and must not survive the transition.
UPDATE "story_production_canvases"
SET "content" = jsonb_set(
    "content",
    '{groups}',
    COALESCE(
        (
            SELECT jsonb_agg("group_value")
            FROM jsonb_array_elements(COALESCE("content"->'groups', '[]'::jsonb))
                AS "group_value"
            WHERE jsonb_array_length(COALESCE("group_value"->'nodeIds', '[]'::jsonb)) >= 2
        ),
        '[]'::jsonb
    ),
    true
)
WHERE "schema_version" = 'story-production-canvas-v2';
