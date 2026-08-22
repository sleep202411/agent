-- Each storyboard clip carries exactly its own kind's prompt: image clips an
-- image_prompt, video clips a video_prompt. The optional "keyframe" image
-- prompt on video clips is removed — a held opening frame is modelled as its
-- own image clip in the sequence. Pre-release data only.
UPDATE "story_storyboard_clips" SET "image_prompt" = NULL WHERE "kind" = 'video';

ALTER TABLE "story_storyboard_clips"
  DROP CONSTRAINT "story_storyboard_clips_prompt_shape_chk";

ALTER TABLE "story_storyboard_clips"
  ADD CONSTRAINT "story_storyboard_clips_prompt_shape_chk" CHECK (
    (
      "kind" = 'image'::"StoryStoryboardClipKind"
      AND "image_prompt" IS NOT NULL
      AND btrim("image_prompt") <> ''
      AND "video_prompt" IS NULL
    )
    OR (
      "kind" = 'video'::"StoryStoryboardClipKind"
      AND "video_prompt" IS NOT NULL
      AND btrim("video_prompt") <> ''
      AND "image_prompt" IS NULL
    )
  );
