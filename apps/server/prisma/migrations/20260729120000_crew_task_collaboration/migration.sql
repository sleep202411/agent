-- Target-state crew collaboration domain. This intentionally does not migrate
-- legacy Episode / EpisodeAssignment rows: CrewTask is a new production unit
-- with a task canvas, immutable submissions, and explicit settlement records.

CREATE TYPE "CrewInvitationStatus" AS ENUM ('pending', 'accepted', 'declined', 'revoked', 'expired');
CREATE TYPE "CrewTaskStatus" AS ENUM ('open', 'in_progress', 'submitted', 'revision_requested', 'approved', 'cancelled');
CREATE TYPE "CrewTaskPriority" AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE "CrewSettlementStatus" AS ENUM ('pending', 'settled');
CREATE TYPE "CrewAgreementStatus" AS ENUM ('draft', 'sent', 'signed', 'voided');

ALTER TABLE "crews"
  ADD COLUMN "workspace_id" UUID,
  ADD COLUMN "production_project_id" UUID;

CREATE UNIQUE INDEX "crews_workspace_unique" ON "crews"("workspace_id");
CREATE UNIQUE INDEX "crews_production_project_unique" ON "crews"("production_project_id");

ALTER TABLE "crews"
  ADD CONSTRAINT "crews_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crews"
  ADD CONSTRAINT "crews_production_project_id_fkey"
  FOREIGN KEY ("production_project_id") REFERENCES "platform_projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crew_invitations" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "invitee_user_id" VARCHAR(64) NOT NULL,
  "invited_by_user_id" VARCHAR(64) NOT NULL,
  "role_type" VARCHAR(64) NOT NULL,
  "status" "CrewInvitationStatus" NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "declined_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_invitations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crew_invitations_crew_status_idx"
  ON "crew_invitations"("crew_id", "status", "created_at" DESC);
CREATE INDEX "crew_invitations_invitee_status_idx"
  ON "crew_invitations"("invitee_user_id", "status", "created_at" DESC);
CREATE UNIQUE INDEX "crew_invitations_one_pending_per_user"
  ON "crew_invitations"("crew_id", "invitee_user_id")
  WHERE "status" = 'pending';
ALTER TABLE "crew_invitations"
  ADD CONSTRAINT "crew_invitations_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew_tasks" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "CrewTaskStatus" NOT NULL DEFAULT 'open',
  "priority" "CrewTaskPriority" NOT NULL DEFAULT 'normal',
  "due_at" TIMESTAMPTZ(6),
  "compute_budget_points" INTEGER,
  "canvas_project_id" UUID NOT NULL,
  "canvas_document_id" UUID NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "approved_by_user_id" VARCHAR(64),
  "submitted_at" TIMESTAMPTZ(6),
  "approved_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_tasks_compute_budget_check"
    CHECK ("compute_budget_points" IS NULL OR "compute_budget_points" >= 0)
);

CREATE UNIQUE INDEX "crew_tasks_canvas_project_unique" ON "crew_tasks"("canvas_project_id");
CREATE UNIQUE INDEX "crew_tasks_canvas_document_unique" ON "crew_tasks"("canvas_document_id");
CREATE INDEX "crew_tasks_crew_status_idx"
  ON "crew_tasks"("crew_id", "status", "updated_at" DESC);
CREATE INDEX "crew_tasks_crew_due_idx" ON "crew_tasks"("crew_id", "due_at");
ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_canvas_project_id_fkey"
  FOREIGN KEY ("canvas_project_id") REFERENCES "platform_projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_canvas_document_id_fkey"
  FOREIGN KEY ("canvas_document_id") REFERENCES "platform_documents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_task_assignees" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "crew_member_id" TEXT NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "reward_amount" BIGINT,
  "reward_currency" VARCHAR(8) NOT NULL DEFAULT 'CNY',
  "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_assignees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_task_assignees_reward_check"
    CHECK ("reward_amount" IS NULL OR "reward_amount" >= 0)
);

CREATE UNIQUE INDEX "crew_task_assignees_task_user_unique"
  ON "crew_task_assignees"("task_id", "user_id");
CREATE INDEX "crew_task_assignees_user_idx"
  ON "crew_task_assignees"("user_id", "assigned_at" DESC);
ALTER TABLE "crew_task_assignees"
  ADD CONSTRAINT "crew_task_assignees_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "crew_tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_assignees"
  ADD CONSTRAINT "crew_task_assignees_crew_member_id_fkey"
  FOREIGN KEY ("crew_member_id") REFERENCES "crew_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_task_submissions" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "submitted_by_user_id" VARCHAR(64) NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "canvas_version_id" UUID,
  "review_note" TEXT,
  "reviewed_by_user_id" VARCHAR(64),
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_task_submissions_version_check" CHECK ("version_number" > 0)
);

CREATE UNIQUE INDEX "crew_task_submissions_task_version_unique"
  ON "crew_task_submissions"("task_id", "version_number");
CREATE INDEX "crew_task_submissions_recent_idx"
  ON "crew_task_submissions"("task_id", "created_at" DESC);
ALTER TABLE "crew_task_submissions"
  ADD CONSTRAINT "crew_task_submissions_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "crew_tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_submissions"
  ADD CONSTRAINT "crew_task_submissions_canvas_version_id_fkey"
  FOREIGN KEY ("canvas_version_id") REFERENCES "platform_document_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_task_submission_assets" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "asset_node_id" UUID NOT NULL,
  CONSTRAINT "crew_task_submission_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crew_task_submission_assets_unique"
  ON "crew_task_submission_assets"("submission_id", "asset_node_id");
CREATE INDEX "crew_task_submission_assets_node_idx"
  ON "crew_task_submission_assets"("asset_node_id");
ALTER TABLE "crew_task_submission_assets"
  ADD CONSTRAINT "crew_task_submission_assets_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "crew_task_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_submission_assets"
  ADD CONSTRAINT "crew_task_submission_assets_asset_node_id_fkey"
  FOREIGN KEY ("asset_node_id") REFERENCES "crew_asset_nodes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_settlement_items" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "crew_member_id" TEXT NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "amount" BIGINT NOT NULL,
  "currency" VARCHAR(8) NOT NULL,
  "status" "CrewSettlementStatus" NOT NULL DEFAULT 'pending',
  "settled_at" TIMESTAMPTZ(6),
  "settled_by_user_id" VARCHAR(64),
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_settlement_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_settlement_items_amount_check" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "crew_settlement_items_task_user_unique"
  ON "crew_settlement_items"("task_id", "user_id");
CREATE INDEX "crew_settlement_items_user_idx"
  ON "crew_settlement_items"("user_id", "status", "created_at" DESC);
ALTER TABLE "crew_settlement_items"
  ADD CONSTRAINT "crew_settlement_items_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "crew_tasks"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_settlement_items"
  ADD CONSTRAINT "crew_settlement_items_crew_member_id_fkey"
  FOREIGN KEY ("crew_member_id") REFERENCES "crew_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_agreements" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "member_user_id" VARCHAR(64) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "provider" VARCHAR(32) NOT NULL DEFAULT 'boldsign',
  "provider_document_id" VARCHAR(180),
  "status" "CrewAgreementStatus" NOT NULL DEFAULT 'draft',
  "asset_node_id" UUID,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "sent_at" TIMESTAMPTZ(6),
  "signed_at" TIMESTAMPTZ(6),
  "voided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_agreements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crew_agreements_crew_status_idx"
  ON "crew_agreements"("crew_id", "status", "updated_at" DESC);
CREATE INDEX "crew_agreements_member_idx"
  ON "crew_agreements"("member_user_id", "status");
ALTER TABLE "crew_agreements"
  ADD CONSTRAINT "crew_agreements_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_agreements"
  ADD CONSTRAINT "crew_agreements_asset_node_id_fkey"
  FOREIGN KEY ("asset_node_id") REFERENCES "crew_asset_nodes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
