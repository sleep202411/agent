-- Workspace Core Foundation.
--
-- New-platform source of truth for ownership, permissions, project
-- assets, wallet accounting, and audit. This migration intentionally
-- does not mirror Java project / point tables.

CREATE TYPE "WorkspaceType" AS ENUM ('personal', 'team');
CREATE TYPE "WorkspaceStatus" AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE "WorkspaceMemberRole" AS ENUM ('owner', 'admin', 'editor', 'viewer', 'billing');
CREATE TYPE "WorkspaceMemberStatus" AS ENUM ('invited', 'active', 'suspended', 'removed');
CREATE TYPE "WorkspaceInviteStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');
CREATE TYPE "PlatformProjectStatus" AS ENUM ('active', 'archived');
CREATE TYPE "ProjectMemberRole" AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE "ProjectMemberStatus" AS ENUM ('active', 'suspended', 'removed');
CREATE TYPE "ProjectVisibility" AS ENUM ('private', 'workspace', 'public');
CREATE TYPE "PlatformDocumentType" AS ENUM ('brief', 'script', 'storyboard', 'shot_plan', 'timeline', 'asset_board', 'course_outline', 'gig_requirement');
CREATE TYPE "PlatformDocumentStatus" AS ENUM ('active', 'archived');
CREATE TYPE "PlatformDocumentVersionSource" AS ENUM ('autosave', 'manual', 'import', 'ai', 'system');
CREATE TYPE "PlatformDocumentOperationType" AS ENUM ('patch', 'yjs_update', 'snapshot', 'comment', 'system');
CREATE TYPE "PlatformDocumentCommentStatus" AS ENUM ('open', 'resolved');
CREATE TYPE "ProjectAssetType" AS ENUM ('image', 'video', 'audio', 'file', 'document', 'model');
CREATE TYPE "ProjectAssetSourceType" AS ENUM ('upload', 'ai_job', 'import', 'manual');
CREATE TYPE "WalletOwnerType" AS ENUM ('user', 'workspace');
CREATE TYPE "WalletCurrencyType" AS ENUM ('bubble', 'community_point');
CREATE TYPE "WalletBalanceKind" AS ENUM ('consumable', 'withdrawable');
CREATE TYPE "WalletAccountStatus" AS ENUM ('active', 'frozen', 'closed');
CREATE TYPE "WalletTransactionStatus" AS ENUM ('pending', 'posted', 'voided', 'failed');
CREATE TYPE "WalletLedgerEntryType" AS ENUM ('credit', 'debit', 'hold', 'release', 'settle', 'refund', 'adjustment', 'transfer_in', 'transfer_out');

CREATE TABLE "workspaces" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" "WorkspaceType" NOT NULL,
  "status" "WorkspaceStatus" NOT NULL DEFAULT 'active',
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(80),
  "avatar_url" VARCHAR(512),
  "description" VARCHAR(500),
  "owner_user_id" VARCHAR(64) NOT NULL,
  "created_by_id" VARCHAR(64) NOT NULL,
  "default_project_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 0,
  "suspended_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "workspaces_slug_format_chk"
    CHECK ("slug" IS NULL OR "slug" ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$')
);

CREATE UNIQUE INDEX "workspaces_personal_owner_unique"
  ON "workspaces" ("owner_user_id")
  WHERE "type" = 'personal' AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "workspaces_slug_unique"
  ON "workspaces" (LOWER("slug"))
  WHERE "slug" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX "workspaces_owner_type_idx"
  ON "workspaces" ("owner_user_id", "type", "deleted_at");

CREATE INDEX "workspaces_status_recent_idx"
  ON "workspaces" ("status", "updated_at" DESC);

CREATE TABLE "workspace_members" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "role" "WorkspaceMemberRole" NOT NULL,
  "status" "WorkspaceMemberStatus" NOT NULL DEFAULT 'active',
  "seat_assigned" BOOLEAN NOT NULL DEFAULT TRUE,
  "invited_by_id" VARCHAR(64),
  "joined_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workspace_members_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "workspace_members_active_unique"
  ON "workspace_members" ("workspace_id", "user_id")
  WHERE "removed_at" IS NULL;

CREATE INDEX "workspace_members_by_user_idx"
  ON "workspace_members" ("user_id", "status");

CREATE INDEX "workspace_members_by_workspace_idx"
  ON "workspace_members" ("workspace_id", "status", "role");

CREATE TABLE "workspace_invites" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "invitee_user_id" VARCHAR(64),
  "invitee_email" VARCHAR(320),
  "role" "WorkspaceMemberRole" NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "status" "WorkspaceInviteStatus" NOT NULL DEFAULT 'pending',
  "invited_by_id" VARCHAR(64) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workspace_invites_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_invites_target_chk"
    CHECK ("invitee_user_id" IS NOT NULL OR "invitee_email" IS NOT NULL)
);

CREATE UNIQUE INDEX "workspace_invites_token_hash_unique"
  ON "workspace_invites" ("token_hash");

CREATE UNIQUE INDEX "workspace_invites_pending_user_unique"
  ON "workspace_invites" ("workspace_id", "invitee_user_id")
  WHERE "status" = 'pending' AND "invitee_user_id" IS NOT NULL;

CREATE UNIQUE INDEX "workspace_invites_pending_email_unique"
  ON "workspace_invites" ("workspace_id", LOWER("invitee_email"))
  WHERE "status" = 'pending' AND "invitee_email" IS NOT NULL;

CREATE INDEX "workspace_invites_by_workspace_idx"
  ON "workspace_invites" ("workspace_id", "status", "created_at" DESC);

CREATE INDEX "workspace_invites_by_user_idx"
  ON "workspace_invites" ("invitee_user_id", "status");

CREATE INDEX "workspace_invites_by_email_idx"
  ON "workspace_invites" ("invitee_email", "status");

CREATE TABLE "platform_projects" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "slug" VARCHAR(100),
  "project_type" VARCHAR(64) NOT NULL DEFAULT 'general',
  "status" "PlatformProjectStatus" NOT NULL DEFAULT 'active',
  "visibility" "ProjectVisibility" NOT NULL DEFAULT 'private',
  "description" TEXT,
  "cover_asset_id" UUID,
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "version" INTEGER NOT NULL DEFAULT 0,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "platform_projects_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "platform_projects_slug_format_chk"
    CHECK ("slug" IS NULL OR "slug" ~ '^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$')
);

ALTER TABLE "platform_projects"
  ADD CONSTRAINT "platform_projects_id_workspace_unique"
  UNIQUE ("id", "workspace_id");

CREATE UNIQUE INDEX "platform_projects_workspace_slug_unique"
  ON "platform_projects" ("workspace_id", LOWER("slug"))
  WHERE "slug" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX "platform_projects_workspace_recent_idx"
  ON "platform_projects" ("workspace_id", "status", "updated_at" DESC);

CREATE INDEX "platform_projects_creator_idx"
  ON "platform_projects" ("created_by_id", "created_at" DESC);

CREATE INDEX "platform_projects_type_recent_idx"
  ON "platform_projects" ("project_type", "status", "updated_at" DESC);

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_default_project_fk"
  FOREIGN KEY ("default_project_id") REFERENCES "platform_projects"("id") ON DELETE SET NULL;

CREATE TABLE "platform_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "type" "PlatformDocumentType" NOT NULL,
  "status" "PlatformDocumentStatus" NOT NULL DEFAULT 'active',
  "title" VARCHAR(160) NOT NULL,
  "slug" VARCHAR(100),
  "schema_version" VARCHAR(32) NOT NULL DEFAULT '2026-05-27',
  "collaboration_dialect" VARCHAR(64) NOT NULL DEFAULT 'fizzdragon.document.v1',
  "collaboration_room_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "content_snapshot" JSONB NOT NULL DEFAULT '{}',
  "crdt_state" BYTEA,
  "current_sequence" INTEGER NOT NULL DEFAULT 0,
  "current_version_id" UUID,
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "version" INTEGER NOT NULL DEFAULT 0,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "platform_documents_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "platform_documents_project_workspace_fk"
    FOREIGN KEY ("project_id", "workspace_id") REFERENCES "platform_projects"("id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "platform_documents_slug_format_chk"
    CHECK ("slug" IS NULL OR "slug" ~ '^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$'),
  CONSTRAINT "platform_documents_sequence_nonnegative_chk"
    CHECK ("current_sequence" >= 0)
);

ALTER TABLE "platform_documents"
  ADD CONSTRAINT "platform_documents_id_workspace_unique"
  UNIQUE ("id", "workspace_id");

CREATE UNIQUE INDEX "platform_documents_project_slug_unique"
  ON "platform_documents" ("project_id", LOWER("slug"))
  WHERE "slug" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "platform_documents_room_unique"
  ON "platform_documents" ("collaboration_room_id");

CREATE INDEX "platform_documents_project_type_recent_idx"
  ON "platform_documents" ("project_id", "type", "updated_at" DESC);

CREATE INDEX "platform_documents_workspace_recent_idx"
  ON "platform_documents" ("workspace_id", "updated_at" DESC);

CREATE INDEX "platform_documents_status_recent_idx"
  ON "platform_documents" ("status", "updated_at" DESC);

CREATE TABLE "platform_document_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "schema_version" VARCHAR(32) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "title" VARCHAR(160),
  "label" VARCHAR(120),
  "source" "PlatformDocumentVersionSource" NOT NULL DEFAULT 'autosave',
  "source_id" VARCHAR(128),
  "snapshot" JSONB NOT NULL,
  "crdt_state" BYTEA,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_document_versions_document_fk"
    FOREIGN KEY ("document_id") REFERENCES "platform_documents"("id") ON DELETE CASCADE,
  CONSTRAINT "platform_document_versions_number_positive_chk"
    CHECK ("version_number" > 0),
  CONSTRAINT "platform_document_versions_sequence_nonnegative_chk"
    CHECK ("sequence" >= 0)
);

CREATE UNIQUE INDEX "platform_document_versions_doc_number_unique"
  ON "platform_document_versions" ("document_id", "version_number");

CREATE INDEX "platform_document_versions_doc_recent_idx"
  ON "platform_document_versions" ("document_id", "created_at" DESC);

CREATE TABLE "platform_document_operations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "operation_type" "PlatformDocumentOperationType" NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "client_mutation_id" VARCHAR(128),
  "idempotency_key" VARCHAR(160),
  "base_sequence" INTEGER,
  "patch" JSONB,
  "yjs_update" BYTEA,
  "snapshot" JSONB,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_document_operations_document_fk"
    FOREIGN KEY ("document_id") REFERENCES "platform_documents"("id") ON DELETE CASCADE,
  CONSTRAINT "platform_document_operations_sequence_positive_chk"
    CHECK ("sequence" > 0),
  CONSTRAINT "platform_document_operations_base_sequence_chk"
    CHECK ("base_sequence" IS NULL OR "base_sequence" >= 0),
  CONSTRAINT "platform_document_operations_payload_chk"
    CHECK ("patch" IS NOT NULL OR "yjs_update" IS NOT NULL OR "snapshot" IS NOT NULL OR "operation_type" = 'system')
);

CREATE UNIQUE INDEX "platform_document_operations_doc_sequence_unique"
  ON "platform_document_operations" ("document_id", "sequence");

CREATE UNIQUE INDEX "platform_document_operations_idempotency_unique"
  ON "platform_document_operations" ("document_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX "platform_document_operations_doc_recent_idx"
  ON "platform_document_operations" ("document_id", "created_at" DESC);

CREATE INDEX "platform_document_operations_actor_recent_idx"
  ON "platform_document_operations" ("actor_user_id", "created_at" DESC);

CREATE TABLE "platform_document_presence" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "connection_id" VARCHAR(128) NOT NULL,
  "cursor" JSONB,
  "selection" JSONB,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_document_presence_document_fk"
    FOREIGN KEY ("document_id") REFERENCES "platform_documents"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "platform_document_presence_connection_unique"
  ON "platform_document_presence" ("document_id", "user_id", "connection_id");

CREATE INDEX "platform_document_presence_active_idx"
  ON "platform_document_presence" ("document_id", "expires_at");

CREATE TABLE "platform_document_comment_threads" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "block_id" VARCHAR(128),
  "anchor" JSONB,
  "title" VARCHAR(160),
  "status" "PlatformDocumentCommentStatus" NOT NULL DEFAULT 'open',
  "created_by_id" VARCHAR(64) NOT NULL,
  "resolved_by_id" VARCHAR(64),
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "platform_document_comment_threads_document_fk"
    FOREIGN KEY ("document_id") REFERENCES "platform_documents"("id") ON DELETE CASCADE
);

CREATE INDEX "platform_document_comment_threads_doc_status_idx"
  ON "platform_document_comment_threads" ("document_id", "status", "updated_at" DESC);

CREATE INDEX "platform_document_comment_threads_block_idx"
  ON "platform_document_comment_threads" ("document_id", "block_id");

CREATE TABLE "platform_document_comments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "created_by_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "edited_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "platform_document_comments_thread_fk"
    FOREIGN KEY ("thread_id") REFERENCES "platform_document_comment_threads"("id") ON DELETE CASCADE
);

CREATE INDEX "platform_document_comments_doc_idx"
  ON "platform_document_comments" ("document_id", "created_at" ASC);

CREATE INDEX "platform_document_comments_thread_idx"
  ON "platform_document_comments" ("thread_id", "created_at" ASC);

CREATE TABLE "project_members" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "role" "ProjectMemberRole" NOT NULL,
  "status" "ProjectMemberStatus" NOT NULL DEFAULT 'active',
  "granted_by_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),

  CONSTRAINT "project_members_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "project_members_active_unique"
  ON "project_members" ("project_id", "user_id")
  WHERE "removed_at" IS NULL;

CREATE INDEX "project_members_by_user_idx"
  ON "project_members" ("user_id", "status");

CREATE INDEX "project_members_by_project_idx"
  ON "project_members" ("project_id", "status", "role");

CREATE TABLE "project_assets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "type" "ProjectAssetType" NOT NULL,
  "source_type" "ProjectAssetSourceType" NOT NULL DEFAULT 'upload',
  "source_id" VARCHAR(128),
  "document_id" UUID,
  "document_block_id" VARCHAR(128),
  "name" VARCHAR(160),
  "url" VARCHAR(1024) NOT NULL,
  "storage_path" VARCHAR(1024),
  "thumbnail_url" VARCHAR(1024),
  "mime_type" VARCHAR(128),
  "bytes" BIGINT,
  "width" INTEGER,
  "height" INTEGER,
  "duration_seconds" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "project_assets_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "project_assets_project_workspace_fk"
    FOREIGN KEY ("project_id", "workspace_id") REFERENCES "platform_projects"("id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "project_assets_document_workspace_fk"
    FOREIGN KEY ("document_id", "workspace_id") REFERENCES "platform_documents"("id", "workspace_id"),
  CONSTRAINT "project_assets_dimensions_chk"
    CHECK (
      ("bytes" IS NULL OR "bytes" >= 0)
      AND ("width" IS NULL OR "width" >= 0)
      AND ("height" IS NULL OR "height" >= 0)
      AND ("duration_seconds" IS NULL OR "duration_seconds" >= 0)
    )
);

CREATE INDEX "project_assets_project_type_recent_idx"
  ON "project_assets" ("project_id", "type", "created_at" DESC);

CREATE INDEX "project_assets_workspace_recent_idx"
  ON "project_assets" ("workspace_id", "created_at" DESC);

CREATE INDEX "project_assets_document_block_idx"
  ON "project_assets" ("document_id", "document_block_id");

CREATE INDEX "project_assets_source_idx"
  ON "project_assets" ("source_type", "source_id");

CREATE INDEX "project_assets_deleted_at_idx"
  ON "project_assets" ("deleted_at");

CREATE TABLE "wallet_accounts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_type" "WalletOwnerType" NOT NULL,
  "owner_id" VARCHAR(64) NOT NULL,
  "currency" "WalletCurrencyType" NOT NULL,
  "balance_kind" "WalletBalanceKind" NOT NULL DEFAULT 'consumable',
  "status" "WalletAccountStatus" NOT NULL DEFAULT 'active',
  "available_balance" BIGINT NOT NULL DEFAULT 0,
  "held_balance" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMPTZ(6),

  CONSTRAINT "wallet_accounts_nonnegative_balance_chk"
    CHECK ("available_balance" >= 0 AND "held_balance" >= 0),
  CONSTRAINT "wallet_accounts_kind_currency_chk"
    CHECK ("currency" <> 'bubble' OR "balance_kind" = 'consumable')
);

CREATE UNIQUE INDEX "wallet_accounts_owner_currency_kind_unique"
  ON "wallet_accounts" ("owner_type", "owner_id", "currency", "balance_kind");

CREATE INDEX "wallet_accounts_owner_status_idx"
  ON "wallet_accounts" ("owner_type", "owner_id", "status", "balance_kind");

CREATE TABLE "wallet_transactions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "status" "WalletTransactionStatus" NOT NULL DEFAULT 'posted',
  "source_type" VARCHAR(64) NOT NULL,
  "source_id" VARCHAR(128),
  "idempotency_key" VARCHAR(160) NOT NULL,
  "actor_user_id" VARCHAR(64),
  "workspace_id" UUID,
  "project_id" UUID,
  "description" VARCHAR(255),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMPTZ(6)
);

CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_unique"
  ON "wallet_transactions" ("idempotency_key");

CREATE INDEX "wallet_transactions_source_idx"
  ON "wallet_transactions" ("source_type", "source_id");

CREATE INDEX "wallet_transactions_actor_recent_idx"
  ON "wallet_transactions" ("actor_user_id", "created_at" DESC);

CREATE INDEX "wallet_transactions_workspace_recent_idx"
  ON "wallet_transactions" ("workspace_id", "created_at" DESC);

CREATE TABLE "wallet_ledger_entries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transaction_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "entry_type" "WalletLedgerEntryType" NOT NULL,
  "currency" "WalletCurrencyType" NOT NULL,
  "balance_kind" "WalletBalanceKind" NOT NULL,
  "amount" BIGINT NOT NULL,
  "available_delta" BIGINT NOT NULL,
  "held_delta" BIGINT NOT NULL,
  "available_balance_after" BIGINT NOT NULL,
  "held_balance_after" BIGINT NOT NULL,
  "reason" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_ledger_entries_transaction_fk"
    FOREIGN KEY ("transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE CASCADE,
  CONSTRAINT "wallet_ledger_entries_account_fk"
    FOREIGN KEY ("account_id") REFERENCES "wallet_accounts"("id"),
  CONSTRAINT "wallet_ledger_entries_amount_positive_chk"
    CHECK ("amount" > 0),
  CONSTRAINT "wallet_ledger_entries_balance_after_nonnegative_chk"
    CHECK ("available_balance_after" >= 0 AND "held_balance_after" >= 0)
);

CREATE INDEX "wallet_ledger_entries_account_recent_idx"
  ON "wallet_ledger_entries" ("account_id", "created_at" DESC);

CREATE INDEX "wallet_ledger_entries_transaction_idx"
  ON "wallet_ledger_entries" ("transaction_id");

CREATE TABLE "platform_audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID,
  "project_id" UUID,
  "actor_user_id" VARCHAR(64),
  "action" VARCHAR(96) NOT NULL,
  "entity_type" VARCHAR(64) NOT NULL,
  "entity_id" VARCHAR(128) NOT NULL,
  "request_id" VARCHAR(128),
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_audit_logs_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL,
  CONSTRAINT "platform_audit_logs_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id") ON DELETE SET NULL
);

CREATE INDEX "platform_audit_workspace_recent_idx"
  ON "platform_audit_logs" ("workspace_id", "created_at" DESC);

CREATE INDEX "platform_audit_project_recent_idx"
  ON "platform_audit_logs" ("project_id", "created_at" DESC);

CREATE INDEX "platform_audit_actor_recent_idx"
  ON "platform_audit_logs" ("actor_user_id", "created_at" DESC);

CREATE INDEX "platform_audit_entity_recent_idx"
  ON "platform_audit_logs" ("entity_type", "entity_id", "created_at" DESC);

-- Attach generation jobs to the Platform Core context. Existing jobs
-- remain user-owned with NULL workspace/project; new Studio submissions
-- resolve a workspace before they enter the queue.
ALTER TABLE "ai_jobs"
  DROP COLUMN IF EXISTS "user_level";

ALTER TABLE "ai_jobs"
  ADD COLUMN "workspace_id" UUID,
  ADD COLUMN "project_id" UUID,
  ADD COLUMN "document_id" UUID,
  ADD COLUMN "document_block_id" VARCHAR(128),
  ADD COLUMN "site_region" VARCHAR(24),
  ADD COLUMN "source_surface" VARCHAR(64),
  ADD COLUMN "entitlement_snapshot" JSONB;

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_workspace_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id");

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_project_fk"
  FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id");

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_document_workspace_fk"
  FOREIGN KEY ("document_id", "workspace_id") REFERENCES "platform_documents"("id", "workspace_id");

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_project_requires_workspace_chk"
  CHECK ("project_id" IS NULL OR "workspace_id" IS NOT NULL);

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_document_requires_workspace_chk"
  CHECK ("document_id" IS NULL OR "workspace_id" IS NOT NULL);

CREATE INDEX "ai_jobs_workspace_created_idx"
  ON "ai_jobs" ("workspace_id", "created_at" DESC);

CREATE INDEX "ai_jobs_project_created_idx"
  ON "ai_jobs" ("project_id", "created_at" DESC);

CREATE INDEX "ai_jobs_document_block_created_idx"
  ON "ai_jobs" ("document_id", "document_block_id", "created_at" DESC);

CREATE INDEX "ai_jobs_site_region_created_idx"
  ON "ai_jobs" ("site_region", "created_at" DESC);
