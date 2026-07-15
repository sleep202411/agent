-- Keyset pagination for the workspace-scoped Story Studio video library.
-- IF NOT EXISTS keeps local re-application safe without mutating the already
-- applied single-current-video migration that precedes this one.
CREATE INDEX IF NOT EXISTS "media_assets_workspace_video_library_idx"
  ON "media_assets" (
    "workspace_id",
    "kind",
    "status",
    "created_at" DESC,
    "id" DESC
  );
