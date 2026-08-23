-- The storyboard timeline is the sole source of a scene's playable content, so
-- the per-node current-video selection layer and its staging-upload pipeline
-- are retired.
--
-- They are PARKED, not dropped. An earlier revision of this migration dropped
-- them outright on the belief that the branch was undeployed; it is not. These
-- tables are live and hold 231 selections across 12 projects — one of them, a
-- production title, holds 113 on its own.
--
-- Nor can the rows be carried across: a selection is ONE video pinned to a
-- graph node, while a storyboard clip is one entry in that node's timeline,
-- keyed by (chapter, sequence, stableKey) and pointing at a media version. A
-- selection row supplies no chapter, no rank, no start, no duration and no
-- source fingerprint, so there is no honest UPDATE that reconstructs a clip
-- from it. Creators re-pick their footage under the new model either way.
--
-- What parking buys is the difference between "the old choices are recoverable"
-- and "the old choices are gone". A rename is reversible in one statement; a
-- DROP is only reversible by restoring the whole database to a point in time.
-- Drop these for real in a follow-up, once a release has shipped and nothing
-- has asked for them.
--
-- "StoryVideoUploadStatus" stays for the same reason: the parked table's status
-- column still uses it.
ALTER TABLE "story_video_selections"
  RENAME TO "_retired_story_video_selections";
ALTER TABLE "story_video_upload_sessions"
  RENAME TO "_retired_story_video_upload_sessions";
