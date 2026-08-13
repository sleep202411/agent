-- Make Agent OS attachments a project-kind-neutral input primitive while
-- preserving real relational ownership for both product project stores.

BEGIN;

ALTER TABLE "agent_os_attachments"
  DROP CONSTRAINT "agent_os_attachments_project_id_fkey";

DROP INDEX "agent_os_attachments_project_recent_idx";

ALTER TABLE "agent_os_attachments"
  RENAME COLUMN "project_id" TO "platform_project_id";

ALTER TABLE "agent_os_attachments"
  ALTER COLUMN "platform_project_id" DROP NOT NULL;

ALTER TABLE "agent_os_attachments"
  ADD COLUMN "project_kind" VARCHAR(32) NOT NULL DEFAULT 'platform',
  ADD COLUMN "story_project_id" UUID;

ALTER TABLE "agent_os_attachments"
  ALTER COLUMN "project_kind" DROP DEFAULT;

ALTER TABLE "agent_os_attachments"
  ADD CONSTRAINT "agent_os_attachments_platform_project_id_fkey"
    FOREIGN KEY ("platform_project_id") REFERENCES "platform_projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_os_attachments_story_project_id_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "agent_os_attachments_project_scope_check"
    CHECK (
      (
        "project_kind" = 'platform'
        AND "platform_project_id" IS NOT NULL
        AND "story_project_id" IS NULL
      )
      OR
      (
        "project_kind" = 'story'
        AND "story_project_id" IS NOT NULL
        AND "platform_project_id" IS NULL
      )
    ),
  ADD CONSTRAINT "agent_os_attachments_status_check"
    CHECK ("status" IN ('ready', 'failed')),
  ADD CONSTRAINT "agent_os_attachments_size_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520);

CREATE INDEX "agent_os_attachments_platform_project_recent_idx"
  ON "agent_os_attachments" ("platform_project_id", "created_at" DESC);

CREATE INDEX "agent_os_attachments_story_project_recent_idx"
  ON "agent_os_attachments" ("story_project_id", "created_at" DESC);

CREATE INDEX "agent_os_attachments_workspace_recent_idx"
  ON "agent_os_attachments" ("workspace_id", "created_at" DESC);

COMMIT;
