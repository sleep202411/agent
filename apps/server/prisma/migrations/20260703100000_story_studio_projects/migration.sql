-- Story Studio dedicated project plane (docs/story-studio-project-schema-v1.md v2).
-- Purely additive: new enums + 3 new tables. Zero touch to existing tables.

-- CreateEnum
CREATE TYPE "StoryProjectStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "StoryPublishState" AS ENUM ('unpublished', 'published', 'offline');

-- CreateEnum
CREATE TYPE "StoryVisibility" AS ENUM ('private', 'public', 'unlisted');

-- CreateTable
CREATE TABLE "story_projects" (
    "id" UUID NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "workspace_id" UUID,
    "title" VARCHAR(160) NOT NULL,
    "summary" TEXT,
    "cover_asset_id" UUID,
    "locale" VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    "visibility" "StoryVisibility" NOT NULL DEFAULT 'private',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "status" "StoryProjectStatus" NOT NULL DEFAULT 'active',
    "source_ip_id" UUID,
    "publish_state" "StoryPublishState" NOT NULL DEFAULT 'unpublished',
    "live_release_id" UUID,
    "published_version" INTEGER,
    "published_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "story_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_drafts" (
    "id" UUID NOT NULL,
    "story_project_id" UUID NOT NULL,
    "schema_version" VARCHAR(40) NOT NULL DEFAULT 'story-studio-canvas-v1',
    "content" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_by_session_id" VARCHAR(64),
    "updated_by_user_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_releases" (
    "id" UUID NOT NULL,
    "story_project_id" UUID NOT NULL,
    "release_version" INTEGER NOT NULL,
    "schema_version" VARCHAR(40) NOT NULL,
    "runtime_json" JSONB NOT NULL,
    "runtime_hash" VARCHAR(64) NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "published_by_user_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_projects_live_release_id_key" ON "story_projects"("live_release_id");

-- CreateIndex
CREATE INDEX "story_projects_owner_idx" ON "story_projects"("owner_user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "story_drafts_story_project_id_key" ON "story_drafts"("story_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_releases_version_unique" ON "story_releases"("story_project_id", "release_version");

-- CreateIndex
CREATE INDEX "story_releases_by_project_idx" ON "story_releases"("story_project_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "story_projects" ADD CONSTRAINT "story_projects_live_release_id_fkey" FOREIGN KEY ("live_release_id") REFERENCES "story_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_projects" ADD CONSTRAINT "story_projects_cover_asset_id_fkey" FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_drafts" ADD CONSTRAINT "story_drafts_story_project_id_fkey" FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_releases" ADD CONSTRAINT "story_releases_story_project_id_fkey" FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
