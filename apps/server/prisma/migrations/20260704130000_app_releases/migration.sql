-- Mobile app version manifest for the in-app update check. Purely additive.

-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('ios', 'android');

-- CreateTable
CREATE TABLE "app_releases" (
    "id" UUID NOT NULL,
    "platform" "AppPlatform" NOT NULL,
    "version_name" VARCHAR(32) NOT NULL,
    "version_code" INTEGER NOT NULL,
    "download_url" VARCHAR(1024) NOT NULL,
    "release_notes" VARCHAR(2000),
    "min_supported_code" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_releases_platform_version_uq" ON "app_releases"("platform", "version_code");

-- CreateIndex
CREATE INDEX "app_releases_platform_latest_idx" ON "app_releases"("platform", "active", "version_code");
