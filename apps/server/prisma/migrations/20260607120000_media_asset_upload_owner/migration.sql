-- Direct-to-storage upload pipeline support on media_assets.
--
-- 1. created_by_user_id: the external (Java) auth user id of whoever
--    issued the signed upload URL this asset tracks. NULL for legacy /
--    worker-produced assets that predate the pipeline. The storage key
--    already physically scopes writes to this user; this column makes the
--    ownership queryable for orphan reclaim (GC) and audit.
--
-- 2. media_assets_status_created_idx: the orphan-reclaim GC sweep selects
--    stale `uploading` rows across ALL kinds ordered by age. The existing
--    kind-led index can't serve a kind-agnostic status scan.

ALTER TABLE "media_assets"
  ADD COLUMN "created_by_user_id" VARCHAR(64);

CREATE INDEX "media_assets_status_created_idx"
  ON "media_assets" ("status", "created_at");
