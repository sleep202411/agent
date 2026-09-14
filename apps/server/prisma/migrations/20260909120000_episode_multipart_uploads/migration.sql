CREATE TYPE "EpisodeUploadStatus" AS ENUM ('initializing', 'uploading', 'uploaded', 'completed', 'aborted');
CREATE TABLE "episode_uploads" (
  "id" UUID NOT NULL PRIMARY KEY,
  "user_id" VARCHAR(64) NOT NULL,
  "workspace_id" UUID,
  "file_name" VARCHAR(256) NOT NULL,
  "content_type" VARCHAR(128) NOT NULL,
  "size_bytes" BIGINT NOT NULL CHECK ("size_bytes" > 0 AND "size_bytes" <= 37580963840),
  "part_size" INTEGER NOT NULL CHECK ("part_size" > 0),
  "provider" "MediaStorageProvider" NOT NULL,
  "storage_key" VARCHAR(1024) NOT NULL UNIQUE,
  "upload_id" VARCHAR(1024),
  "bucket" VARCHAR(128),
  "region" VARCHAR(64),
  "status" "EpisodeUploadStatus" NOT NULL DEFAULT 'initializing',
  "lease_until" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "episode_uploads_expires_at_idx" ON "episode_uploads" ("expires_at");
