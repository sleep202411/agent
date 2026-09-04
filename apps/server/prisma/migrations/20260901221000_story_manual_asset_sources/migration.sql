-- Agent-planned specs remain traceable to Script scenes. A manual Asset Spec
-- can start independently and acquire Storyboard bindings later.
ALTER TABLE "story_asset_specs"
  DROP CONSTRAINT "story_asset_specs_source_nodes_chk",
  ADD CONSTRAINT "story_asset_specs_source_nodes_chk" CHECK (
    jsonb_typeof("source_node_ids") = 'array'
    AND (
      jsonb_array_length("source_node_ids") > 0
      OR "plan_disposition" = 'user_override'::"StoryProductionPlanDisposition"
    )
  );
