-- A multi-chapter work has no single publishable Build: a chapter ends in an
-- ending, so composing the chapters into one Runtime Manifest would make every
-- chapter after the first unreachable. Each chapter is therefore published as
-- its own manifest object and Java receives the Game Manifest that lists them.
-- The release lifecycle consequently hangs off the project and its chapter set
-- instead of a Build, which is what these two tables record. The Build-scoped
-- publication lifecycle is untouched and still owns single-manifest releases.

BEGIN;

CREATE TABLE "story_experience_game_releases" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "game_id" VARCHAR(160) NOT NULL,
  "content_version" VARCHAR(160) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "status" "StoryExperiencePublicationStatus" NOT NULL DEFAULT 'pending',
  "requested_set_current" BOOLEAN NOT NULL DEFAULT TRUE,
  "requested_by_user_id" VARCHAR(64) NOT NULL,
  "media_authorized_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "media_authorization_revoked_at" TIMESTAMPTZ(6),
  "manifest_url" TEXT,
  "published_at" TIMESTAMPTZ(6),
  "rejected_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "first_attempt_at" TIMESTAMPTZ(6),
  "last_attempt_at" TIMESTAMPTZ(6),
  "next_attempt_at" TIMESTAMPTZ(6),
  "last_attempted_by_user_id" VARCHAR(64),
  "lease_owner" VARCHAR(160),
  "lease_acquired_at" TIMESTAMPTZ(6),
  "lease_expires_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_detail" TEXT,
  "last_error_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_experience_game_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_experience_game_releases_identity_nonempty_chk" CHECK (
    btrim("game_id") <> '' AND
    btrim("content_version") <> '' AND
    btrim("requested_by_user_id") <> ''
  ),
  CONSTRAINT "story_experience_game_releases_request_hash_chk" CHECK (
    "request_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "story_experience_game_releases_attempts_chk" CHECK ("attempt_count" >= 0),
  -- A confirmed release must carry the Java acknowledgement it was confirmed
  -- from; without this a corrupt row would be indistinguishable from a
  -- published one and would be replayed to players as a live release.
  CONSTRAINT "story_experience_game_releases_confirmed_shape_chk" CHECK (
    "status" <> 'confirmed' OR ("manifest_url" IS NOT NULL AND "published_at" IS NOT NULL)
  ),
  CONSTRAINT "story_experience_game_releases_rejected_shape_chk" CHECK (
    "status" <> 'rejected' OR "rejected_at" IS NOT NULL
  ),
  -- Media authorization is revocable only by a definitive rejection, so an
  -- ambiguous outcome can never strip a live release of its media.
  CONSTRAINT "story_experience_game_releases_media_revoke_chk" CHECK (
    "media_authorization_revoked_at" IS NULL OR "status" = 'rejected'
  )
);

CREATE UNIQUE INDEX "story_experience_game_releases_project_version_unique"
  ON "story_experience_game_releases" ("story_project_id", "content_version");
CREATE UNIQUE INDEX "story_experience_game_releases_game_version_unique"
  ON "story_experience_game_releases" ("game_id", "content_version");
CREATE INDEX "story_experience_game_releases_project_recent_idx"
  ON "story_experience_game_releases" ("story_project_id", "status", "created_at" DESC);
CREATE INDEX "story_experience_game_releases_project_lease_idx"
  ON "story_experience_game_releases" ("story_project_id", "status", "lease_expires_at");

ALTER TABLE "story_experience_game_releases"
  ADD CONSTRAINT "story_experience_game_releases_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "story_experience_game_release_chapters" (
  "id" UUID NOT NULL,
  "game_release_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "build_id" UUID NOT NULL,
  "rank" INTEGER NOT NULL,
  "manifest_key" TEXT NOT NULL,
  "manifest_url" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_experience_game_release_chapters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_experience_game_release_chapters_rank_chk" CHECK ("rank" >= 0),
  CONSTRAINT "story_experience_game_release_chapters_object_nonempty_chk" CHECK (
    btrim("manifest_key") <> '' AND btrim("manifest_url") <> ''
  )
);

CREATE UNIQUE INDEX "story_experience_game_release_chapters_chapter_unique"
  ON "story_experience_game_release_chapters" ("game_release_id", "story_chapter_id");
CREATE UNIQUE INDEX "story_experience_game_release_chapters_rank_unique"
  ON "story_experience_game_release_chapters" ("game_release_id", "rank");
CREATE INDEX "story_experience_game_release_chapters_build_idx"
  ON "story_experience_game_release_chapters" ("build_id");

ALTER TABLE "story_experience_game_release_chapters"
  ADD CONSTRAINT "story_experience_game_release_chapters_game_release_id_fkey"
  FOREIGN KEY ("game_release_id") REFERENCES "story_experience_game_releases" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The Build reference is RESTRICT because the published chapter manifest names
-- that Build's frozen media, and this row is what authorizes anonymous
-- delivery of it.
ALTER TABLE "story_experience_game_release_chapters"
  ADD CONSTRAINT "story_experience_game_release_chapters_build_fkey"
  FOREIGN KEY ("build_id", "story_project_id") REFERENCES "story_builds" ("id", "story_project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMENT ON COLUMN "story_experience_game_releases"."content_version" IS
  'Canonical hash of the published chapter table of contents; a changed chapter set is a new release.';
COMMENT ON COLUMN "story_experience_game_releases"."media_authorized_at" IS
  'Immutable anonymous media grant for every listed chapter, created before the first Java publish request.';

COMMIT;
