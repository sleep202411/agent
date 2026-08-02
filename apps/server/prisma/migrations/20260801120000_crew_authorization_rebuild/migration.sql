-- Crew authorization rebuild.
--
-- This is an intentional cut-over, not a compatibility migration:
-- ownership, production positions and permissions become independent domain
-- concepts, and the legacy founder_id / role_type / is_finance model is
-- removed in the same migration.

ALTER TYPE "CrewMemberVia" RENAME TO "CrewJoinSource";
ALTER TYPE "CrewJoinSource" RENAME VALUE 'founder' TO 'creation';

CREATE TYPE "CrewMembershipStatus" AS ENUM ('active', 'suspended', 'removed');
CREATE TYPE "CrewPermissionEffect" AS ENUM ('allow', 'deny');

DROP INDEX "crews_founder_idx";
ALTER TABLE "crews" RENAME COLUMN "founder_id" TO "created_by_user_id";
CREATE INDEX "crews_creator_idx"
  ON "crews" ("created_by_user_id", "deleted_at");

ALTER TABLE "crew_members" RENAME COLUMN "via" TO "joined_via";
ALTER TABLE "crew_members"
  ADD COLUMN "status" "CrewMembershipStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "suspended_at" TIMESTAMPTZ(6),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "crew_members"
SET "status" = CASE
  WHEN "removed_at" IS NULL THEN 'active'::"CrewMembershipStatus"
  ELSE 'removed'::"CrewMembershipStatus"
END;

DROP INDEX "crew_members_active_unique";
DROP INDEX "crew_members_by_user_idx";
DROP INDEX "crew_members_by_crew_idx";
DROP INDEX "crew_members_page_idx";

CREATE UNIQUE INDEX "crew_members_active_unique"
  ON "crew_members" ("crew_id", "user_id")
  WHERE "status" IN ('active', 'suspended');
CREATE UNIQUE INDEX "crew_members_id_crew_unique"
  ON "crew_members" ("id", "crew_id");
CREATE INDEX "crew_members_by_user_idx"
  ON "crew_members" ("user_id", "status");
CREATE INDEX "crew_members_by_crew_idx"
  ON "crew_members" ("crew_id", "status");
CREATE INDEX "crew_members_page_idx"
  ON "crew_members" ("crew_id", "status", "joined_at", "id");

ALTER TABLE "crew_members"
  ADD CONSTRAINT "crew_members_status_timestamps_chk"
  CHECK (
    ("status" = 'active' AND "suspended_at" IS NULL AND "removed_at" IS NULL)
    OR
    ("status" = 'suspended' AND "suspended_at" IS NOT NULL AND "removed_at" IS NULL)
    OR
    ("status" = 'removed' AND "removed_at" IS NOT NULL)
  );

-- Ownership is a unique relationship to an active member, not a job title.
CREATE TABLE "crew_ownership" (
  "crew_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_ownership_pkey" PRIMARY KEY ("crew_id")
);

CREATE UNIQUE INDEX "crew_ownership_member_unique"
  ON "crew_ownership" ("member_id");
CREATE UNIQUE INDEX "crew_ownership_member_crew_unique"
  ON "crew_ownership" ("member_id", "crew_id");

INSERT INTO "crew_ownership" ("crew_id", "member_id", "acquired_at")
SELECT c."id", m."id", COALESCE(m."joined_at", c."created_at")
FROM "crews" c
JOIN "crew_members" m
  ON m."crew_id" = c."id"
 AND m."user_id" = c."created_by_user_id"
 AND m."status" = 'active';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "crews" c
    LEFT JOIN "crew_ownership" o ON o."crew_id" = c."id"
    WHERE c."deleted_at" IS NULL AND o."crew_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'crew authorization rebuild: an active crew has no active owner membership';
  END IF;
END $$;

ALTER TABLE "crew_ownership"
  ADD CONSTRAINT "crew_ownership_crew_id_fkey"
    FOREIGN KEY ("crew_id") REFERENCES "crews" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "crew_ownership_member_crew_fkey"
    FOREIGN KEY ("member_id", "crew_id")
    REFERENCES "crew_members" ("id", "crew_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Production responsibilities are many-to-one member attributes.
CREATE TABLE "crew_member_positions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "crew_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "category_key" VARCHAR(64),
  "title" VARCHAR(128),
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "source_position_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_member_positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_member_positions_descriptor_chk" CHECK (
    "category_key" IS NOT NULL OR length(btrim("title")) > 0
  ),
  CONSTRAINT "crew_member_positions_category_chk" CHECK (
    "category_key" IS NULL OR "category_key" IN (
      'director', 'screenwriter', 'storyboard', 'character_design',
      'background_design', 'animator', 'voice_actor', 'sound_designer',
      'music_composer', 'editor', 'compositor', 'producer', 'marketing'
    )
  )
);

CREATE UNIQUE INDEX "crew_member_positions_one_primary"
  ON "crew_member_positions" ("member_id")
  WHERE "is_primary" = true;
CREATE INDEX "crew_member_positions_crew_category_idx"
  ON "crew_member_positions" ("crew_id", "category_key");
CREATE INDEX "crew_member_positions_member_primary_idx"
  ON "crew_member_positions" ("member_id", "is_primary");

INSERT INTO "crew_member_positions" (
  "crew_id", "member_id", "category_key", "title", "is_primary",
  "source_position_id", "created_at", "updated_at"
)
SELECT
  m."crew_id",
  m."id",
  CASE WHEN m."role_type" IN (
    'director', 'screenwriter', 'storyboard', 'character_design',
    'background_design', 'animator', 'voice_actor', 'sound_designer',
    'music_composer', 'editor', 'compositor', 'producer', 'marketing'
  ) THEN m."role_type" ELSE NULL END,
  CASE
    WHEN m."role_type" IN (
      'owner', 'member', 'director', 'screenwriter', 'storyboard',
      'character_design', 'background_design', 'animator', 'voice_actor',
      'sound_designer', 'music_composer', 'editor', 'compositor',
      'producer', 'marketing'
    ) THEN NULL
    ELSE m."role_type"
  END,
  true,
  m."position_id",
  m."joined_at",
  m."joined_at"
FROM "crew_members" m
WHERE m."role_type" NOT IN ('owner', 'member');

ALTER TABLE "crew_member_positions"
  ADD CONSTRAINT "crew_member_positions_member_crew_fkey"
    FOREIGN KEY ("member_id", "crew_id")
    REFERENCES "crew_members" ("id", "crew_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "crew_member_positions_source_crew_fkey"
    FOREIGN KEY ("source_position_id", "crew_id")
    REFERENCES "crew_positions" ("id", "crew_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additive policy bundles. Active membership supplies the member baseline.
CREATE TABLE "crew_member_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "member_id" TEXT NOT NULL,
  "policy_key" VARCHAR(64) NOT NULL,
  "assigned_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_member_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_member_policies_key_chk" CHECK (
    "policy_key" IN ('admin', 'finance')
  )
);

CREATE UNIQUE INDEX "crew_member_policies_member_key_unique"
  ON "crew_member_policies" ("member_id", "policy_key");
CREATE INDEX "crew_member_policies_key_member_idx"
  ON "crew_member_policies" ("policy_key", "member_id");

INSERT INTO "crew_member_policies" (
  "member_id", "policy_key", "assigned_by_user_id", "created_at"
)
SELECT m."id", 'finance', c."created_by_user_id", CURRENT_TIMESTAMP
FROM "crew_members" m
JOIN "crews" c ON c."id" = m."crew_id"
WHERE m."is_finance" = true AND m."status" <> 'removed';

ALTER TABLE "crew_member_policies"
  ADD CONSTRAINT "crew_member_policies_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "crew_members" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew_member_permission_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "member_id" TEXT NOT NULL,
  "permission_key" VARCHAR(96) NOT NULL,
  "effect" "CrewPermissionEffect" NOT NULL,
  "changed_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_member_permission_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_member_permission_overrides_key_chk" CHECK (
    "permission_key" IN (
      'crew.settings.manage',
      'members.view', 'members.invite', 'members.manage',
      'openings.manage', 'applications.review',
      'tasks.view', 'tasks.manage', 'tasks.comment',
      'tasks.submit_assigned', 'tasks.review',
      'assets.view', 'assets.upload', 'assets.manage',
      'agreements.view_own', 'agreements.manage',
      'finance.view', 'finance.settle',
      'studio.view', 'studio.edit'
    )
  )
);

CREATE UNIQUE INDEX "crew_member_permission_overrides_member_key_unique"
  ON "crew_member_permission_overrides" ("member_id", "permission_key");
CREATE INDEX "crew_member_permission_overrides_permission_idx"
  ON "crew_member_permission_overrides" ("permission_key", "effect");
ALTER TABLE "crew_member_permission_overrides"
  ADD CONSTRAINT "crew_member_permission_overrides_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "crew_members" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew_authorization_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "crew_id" TEXT NOT NULL,
  "member_id" TEXT,
  "actor_member_id" TEXT,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_authorization_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crew_authorization_events_crew_recent_idx"
  ON "crew_authorization_events" ("crew_id", "created_at" DESC);
CREATE INDEX "crew_authorization_events_member_recent_idx"
  ON "crew_authorization_events" ("member_id", "created_at" DESC);
ALTER TABLE "crew_authorization_events"
  ADD CONSTRAINT "crew_authorization_events_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "crew_members" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "crew_authorization_events_actor_member_id_fkey"
    FOREIGN KEY ("actor_member_id") REFERENCES "crew_members" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Invitations carry the proposed production position and additive policy
-- bundles that will be applied atomically when accepted.
ALTER TABLE "crew_invitations"
  ADD COLUMN "position_category_key" VARCHAR(64),
  ADD COLUMN "position_title" VARCHAR(128),
  ADD COLUMN "policy_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "crew_invitations"
SET
  "position_category_key" = CASE WHEN "role_type" IN (
    'director', 'screenwriter', 'storyboard', 'character_design',
    'background_design', 'animator', 'voice_actor', 'sound_designer',
    'music_composer', 'editor', 'compositor', 'producer', 'marketing'
  ) THEN "role_type" ELSE NULL END,
  "position_title" = CASE WHEN "role_type" IN (
    'director', 'screenwriter', 'storyboard', 'character_design',
    'background_design', 'animator', 'voice_actor', 'sound_designer',
    'music_composer', 'editor', 'compositor', 'producer', 'marketing'
  ) THEN NULL ELSE "role_type" END;

ALTER TABLE "crew_invitations"
  ADD CONSTRAINT "crew_invitations_position_chk" CHECK (
    "position_category_key" IS NOT NULL OR length(btrim("position_title")) > 0
  ),
  ADD CONSTRAINT "crew_invitations_position_category_chk" CHECK (
    "position_category_key" IS NULL OR "position_category_key" IN (
      'director', 'screenwriter', 'storyboard', 'character_design',
      'background_design', 'animator', 'voice_actor', 'sound_designer',
      'music_composer', 'editor', 'compositor', 'producer', 'marketing'
    )
  ),
  ADD CONSTRAINT "crew_invitations_policy_keys_chk" CHECK (
    "policy_keys" <@ ARRAY['admin', 'finance']::TEXT[]
  );

-- Remove the old mixed-concern fields after every durable concept has been
-- backfilled into its target table.
ALTER TABLE "crew_members" DROP CONSTRAINT "crew_members_position_id_fkey";
ALTER TABLE "crew_members"
  DROP COLUMN "role_type",
  DROP COLUMN "position_id",
  DROP COLUMN "is_finance";
ALTER TABLE "crew_invitations" DROP COLUMN "role_type";
