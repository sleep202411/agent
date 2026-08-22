-- The storyboard timeline is the sole source of a scene's playable content:
-- the per-node current-video selection layer and its staging-upload pipeline
-- are retired wholesale. Undeployed branch — tables are dropped outright.
DROP TABLE "story_video_selections";
DROP TABLE "story_video_upload_sessions";
DROP TYPE "StoryVideoUploadStatus";
