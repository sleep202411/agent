-- A Plot node and its Storyboard row are one entity at the product boundary.
-- The row therefore needs to exist before the creator adds the first shot.
ALTER TABLE "story_storyboard_sequences"
  DROP CONSTRAINT "story_storyboard_sequences_duration_chk";

ALTER TABLE "story_storyboard_sequences"
  ADD CONSTRAINT "story_storyboard_sequences_duration_chk"
  CHECK ("suggested_duration_ms" >= 0 AND "duration_ms" >= 0);

COMMENT ON COLUMN "story_storyboard_sequences"."duration_ms" IS
  'Zero is the canonical empty timeline for a Plot node with no storyboard clips yet.';

-- Existing legacy duplicates must remain inspectable by the repair command,
-- so use a forward guard instead of an index that could make deployment fail
-- before the repair window. Application transactions also serialize identity
-- creation; this trigger fails loud for ordinary duplicate writes.
CREATE INDEX "story_storyboard_sequences_project_plot_idx"
  ON "story_storyboard_sequences" ("story_project_id", "plot_node_id");

CREATE FUNCTION "story_storyboard_active_node_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" <> 'archived' AND EXISTS (
    SELECT 1
    FROM "story_storyboard_sequences" existing
    WHERE existing."story_project_id" = NEW."story_project_id"
      AND existing."plot_node_id" = NEW."plot_node_id"
      AND existing."status" <> 'archived'
      AND existing."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'A Plot node can own only one active Storyboard timeline'
      USING ERRCODE = '23505',
            CONSTRAINT = 'story_storyboard_sequences_project_plot_active_unique';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "story_storyboard_active_node_identity_guard_trigger"
BEFORE INSERT OR UPDATE OF
  "story_project_id", "plot_node_id", "status"
ON "story_storyboard_sequences"
FOR EACH ROW
EXECUTE FUNCTION "story_storyboard_active_node_identity_guard"();
