-- Story-canvas directing-skill catalog v2: halftone-collage joins the write-
-- legal set. Retired six-skill-era keys stay write-legal because existing
-- conversation rows may carry them; the API layer alone admits the CURRENT
-- catalog, so this constraint only guards against unknown junk.
ALTER TABLE "copilot_conversations"
  DROP CONSTRAINT "copilot_conversations_selected_skills_catalog";
ALTER TABLE "copilot_conversations"
  ADD CONSTRAINT "copilot_conversations_selected_skills_catalog" CHECK (
    jsonb_typeof("selected_skill_keys") = 'array' AND
    jsonb_array_length("selected_skill_keys") <= 1 AND
    "selected_skill_keys" <@ '[
      "story.directing.halftone-collage.v1",
      "story.directing.symmetrical-storybook.v1",
      "story.directing.intimate-realism.v1",
      "story.directing.eastern-dreamscape.v1",
      "story.directing.psychological-mystery.v1",
      "story.directing.retro-future-noir.v1",
      "story.directing.handcrafted-fable.v1"
    ]'::jsonb AND
    ("mode" <> 'canvas' OR "selected_skill_keys" = '[]'::jsonb)
  );
