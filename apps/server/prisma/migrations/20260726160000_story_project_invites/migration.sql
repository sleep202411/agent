-- Story-project invite links. Mirrors project_invites (sha256-at-rest bearer
-- token, multi-use until revoke/expiry) but grants a StoryProjectMemberRole.
CREATE TYPE "StoryProjectInviteStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE "story_project_invites" (
    "id" UUID NOT NULL,
    "story_project_id" UUID NOT NULL,
    "role" "StoryProjectMemberRole" NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "status" "StoryProjectInviteStatus" NOT NULL DEFAULT 'pending',
    "invited_by_user_id" VARCHAR(64) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_project_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_project_invites_token_hash_unique" ON "story_project_invites"("token_hash");
CREATE INDEX "story_project_invites_by_project_idx" ON "story_project_invites"("story_project_id", "status", "created_at" DESC);

ALTER TABLE "story_project_invites"
  ADD CONSTRAINT "story_project_invites_story_project_id_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
