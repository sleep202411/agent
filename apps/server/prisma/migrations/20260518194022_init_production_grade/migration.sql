-- CreateEnum
CREATE TYPE "CrewPositionStatus" AS ENUM ('open', 'frozen', 'full');

-- CreateEnum
CREATE TYPE "CrewMemberVia" AS ENUM ('founder', 'application', 'manual');

-- CreateEnum
CREATE TYPE "CrewApplicationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('not_started', 'in_production', 'approved');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('in_progress', 'submitted', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "crews" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT NOT NULL,
    "cover_image" TEXT NOT NULL,
    "cover_video" TEXT,
    "founder_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "crews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_positions" (
    "id" TEXT NOT NULL,
    "crew_id" TEXT NOT NULL,
    "position_type" VARCHAR(64) NOT NULL,
    "description" TEXT NOT NULL,
    "target_count" INTEGER NOT NULL,
    "recruited_count" INTEGER NOT NULL DEFAULT 0,
    "status" "CrewPositionStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "crew_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_members" (
    "id" TEXT NOT NULL,
    "crew_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_type" VARCHAR(64) NOT NULL,
    "position_id" TEXT,
    "via" "CrewMemberVia" NOT NULL,
    "is_finance" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_applications" (
    "id" TEXT NOT NULL,
    "crew_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "applicant_id" TEXT NOT NULL,
    "message" TEXT,
    "status" "CrewApplicationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewer_id" TEXT,

    CONSTRAINT "crew_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" TEXT NOT NULL,
    "crew_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(128),
    "description" TEXT,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'not_started',
    "deadline" DATE,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_assignments" (
    "id" TEXT NOT NULL,
    "crew_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position_id" TEXT,
    "role_name" VARCHAR(64),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'in_progress',
    "submission_url" TEXT,
    "submission_note" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "reject_suggestion" TEXT,
    "rejected_at" TIMESTAMPTZ(6),
    "revenue_amount" BIGINT,
    "revenue_currency" VARCHAR(8) DEFAULT 'CNY',
    "revenue_set_at" TIMESTAMPTZ(6),
    "revenue_set_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_activities" (
    "id" TEXT NOT NULL,
    "crew_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_name" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dispatched_at" TIMESTAMPTZ(6),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" TEXT,
    "dead_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crews_founder_idx" ON "crews"("founder_id", "deleted_at");

-- CreateIndex
CREATE INDEX "crews_feed_idx" ON "crews"("deleted_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "crew_positions_listing_idx" ON "crew_positions"("crew_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "crew_members_by_user_idx" ON "crew_members"("user_id", "removed_at");

-- CreateIndex
CREATE INDEX "crew_members_by_crew_idx" ON "crew_members"("crew_id", "removed_at");

-- CreateIndex
CREATE INDEX "crew_applications_inbox_idx" ON "crew_applications"("crew_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "crew_applications_by_user_idx" ON "crew_applications"("applicant_id", "status");

-- CreateIndex
CREATE INDEX "episodes_crew_status_idx" ON "episodes"("crew_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_crew_number_unique" ON "episodes"("crew_id", "number");

-- CreateIndex
CREATE INDEX "episode_assignments_user_idx" ON "episode_assignments"("crew_id", "user_id");

-- CreateIndex
CREATE INDEX "episode_assignments_by_episode_idx" ON "episode_assignments"("episode_id");

-- CreateIndex
CREATE INDEX "episode_assignments_revenue_idx" ON "episode_assignments"("revenue_set_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "episode_assignments_unique" ON "episode_assignments"("episode_id", "user_id");

-- CreateIndex
CREATE INDEX "episode_activities_timeline_idx" ON "episode_activities"("episode_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_unread_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_feed_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_unique" ON "notifications"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox"("dispatched_at", "dead_at", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_outbox_per_notif_idx" ON "notification_outbox"("notification_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_outbox_locked_idx" ON "notification_outbox"("locked_at");

-- CreateIndex
CREATE INDEX "notification_outbox_dead_idx" ON "notification_outbox"("dead_at");

-- AddForeignKey
ALTER TABLE "crew_positions" ADD CONSTRAINT "crew_positions_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "crew_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_applications" ADD CONSTRAINT "crew_applications_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_applications" ADD CONSTRAINT "crew_applications_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "crew_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_assignments" ADD CONSTRAINT "episode_assignments_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_activities" ADD CONSTRAINT "episode_activities_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Production-grade hardening (raw SQL — Prisma DSL can't express
-- CHECK constraints or partial-unique indexes).
-- ─────────────────────────────────────────────────────────────

-- CHECK constraints — data integrity at the DB layer so a service
-- bug, a manual psql edit, or a race in count maintenance can't
-- write impossible values. Names mirror the constraint pattern used
-- elsewhere (chk_<table>_<rule>).

ALTER TABLE "crews"
  ADD CONSTRAINT "chk_crews_version_nonneg" CHECK ("version" >= 0);

ALTER TABLE "crew_positions"
  ADD CONSTRAINT "chk_crew_positions_target_positive" CHECK ("target_count" > 0),
  ADD CONSTRAINT "chk_crew_positions_recruited_nonneg" CHECK ("recruited_count" >= 0),
  ADD CONSTRAINT "chk_crew_positions_recruited_le_target" CHECK ("recruited_count" <= "target_count");

ALTER TABLE "episodes"
  ADD CONSTRAINT "chk_episodes_number_positive" CHECK ("number" > 0);

ALTER TABLE "episode_assignments"
  ADD CONSTRAINT "chk_episode_assignments_revenue_nonneg"
    CHECK ("revenue_amount" IS NULL OR "revenue_amount" >= 0),
  ADD CONSTRAINT "chk_episode_assignments_revenue_currency_cny"
    CHECK ("revenue_currency" IS NULL OR "revenue_currency" = 'CNY');

ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "chk_notification_outbox_attempt_nonneg" CHECK ("attempt" >= 0);

-- Partial-unique indexes — Prisma 7 DSL has no WHERE on @@unique.
-- These enforce the real business rules that the application code
-- relies on:

-- crew_members: at most ONE active membership per (crew, user). Removed
-- rows can stack up as historical records without violating the rule.
CREATE UNIQUE INDEX "crew_members_active_unique"
  ON "crew_members" ("crew_id", "user_id")
  WHERE "removed_at" IS NULL;

-- crew_applications: at most ONE pending application per (position,
-- applicant). Resolved (approved / rejected) rows can stack up so the
-- user can apply again after a rejection.
CREATE UNIQUE INDEX "crew_applications_one_pending_per_user"
  ON "crew_applications" ("position_id", "applicant_id")
  WHERE "status" = 'pending';
