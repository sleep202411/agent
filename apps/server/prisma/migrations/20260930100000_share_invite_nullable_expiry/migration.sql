-- Share invite links: allow null expires_at so "until you revoke" matches the product copy.
-- Previously every link was forced to 1–30 days (default 7) even though the UI said permanent.

ALTER TABLE "workspace_invites"
  ALTER COLUMN "expires_at" DROP NOT NULL;

ALTER TABLE "project_invites"
  ALTER COLUMN "expires_at" DROP NOT NULL;

ALTER TABLE "story_project_invites"
  ALTER COLUMN "expires_at" DROP NOT NULL;
