-- Agent OS user-uploaded attachments (scripts / docs) for tool reads by attachmentId.

CREATE TABLE "agent_os_attachments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "uploaded_by_user_id" VARCHAR(64) NOT NULL,
    "filename" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "text_content" TEXT,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_os_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_os_attachments_project_recent_idx"
  ON "agent_os_attachments" ("project_id", "created_at" DESC);

ALTER TABLE "agent_os_attachments"
  ADD CONSTRAINT "agent_os_attachments_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
