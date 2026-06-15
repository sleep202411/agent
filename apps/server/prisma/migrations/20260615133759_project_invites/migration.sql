-- Project-level invites. Mirrors workspace_invites, scoped to a project,
-- using ProjectMemberRole (no billing). Token-hash unique + per-status
-- partial uniques give server-side idempotency on "one pending invite per
-- target". Wires the per-project arm of team collaboration sharing.

CREATE TYPE "ProjectInviteStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE "project_invites" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "invitee_user_id" VARCHAR(64),
  "invitee_email" VARCHAR(320),
  "role" "ProjectMemberRole" NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "status" "ProjectInviteStatus" NOT NULL DEFAULT 'pending',
  "invited_by_id" VARCHAR(64) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_invites_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_invites_target_chk"
    CHECK ("invitee_user_id" IS NOT NULL OR "invitee_email" IS NOT NULL)
);

CREATE UNIQUE INDEX "project_invites_token_hash_unique"
  ON "project_invites" ("token_hash");

CREATE UNIQUE INDEX "project_invites_pending_user_unique"
  ON "project_invites" ("project_id", "invitee_user_id")
  WHERE "status" = 'pending' AND "invitee_user_id" IS NOT NULL;

CREATE UNIQUE INDEX "project_invites_pending_email_unique"
  ON "project_invites" ("project_id", LOWER("invitee_email"))
  WHERE "status" = 'pending' AND "invitee_email" IS NOT NULL;

CREATE INDEX "project_invites_by_project_idx"
  ON "project_invites" ("project_id", "status", "created_at" DESC);

CREATE INDEX "project_invites_by_user_idx"
  ON "project_invites" ("invitee_user_id", "status");

CREATE INDEX "project_invites_by_email_idx"
  ON "project_invites" ("invitee_email", "status");
