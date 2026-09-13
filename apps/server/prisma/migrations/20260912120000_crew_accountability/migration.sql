-- CreateTable
CREATE TABLE "crew_task_commitments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "promised_due_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL DEFAULT '',
    "released_at" TIMESTAMPTZ(6),
    "handover_note" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_task_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_participation_records" (
    "id" UUID NOT NULL,
    "crew_id" TEXT NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "withdrawal_at" TIMESTAMPTZ(6),
    "withdrawal_reason" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" VARCHAR(64),
    "resolution" TEXT,
    "community_points" INTEGER NOT NULL DEFAULT 0,
    "awarded_at" TIMESTAMPTZ(6),
    "awarded_by_user_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_participation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_peer_feedback" (
    "id" UUID NOT NULL,
    "crew_id" TEXT NOT NULL,
    "author_user_id" VARCHAR(64) NOT NULL,
    "subject_user_id" VARCHAR(64) NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "response" TEXT,
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_peer_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crew_task_commitments_assignment_id_key" ON "crew_task_commitments"("assignment_id");

-- CreateIndex
CREATE INDEX "crew_task_commitments_task_id_accepted_at_idx" ON "crew_task_commitments"("task_id", "accepted_at");

-- CreateIndex
CREATE INDEX "crew_task_commitments_user_id_accepted_at_idx" ON "crew_task_commitments"("user_id", "accepted_at");

-- CreateIndex
CREATE INDEX "crew_participation_records_user_id_created_at_idx" ON "crew_participation_records"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crew_participation_records_crew_id_user_id_key" ON "crew_participation_records"("crew_id", "user_id");

-- CreateIndex
CREATE INDEX "crew_peer_feedback_subject_user_id_created_at_idx" ON "crew_peer_feedback"("subject_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crew_peer_feedback_crew_id_author_user_id_subject_user_id_key" ON "crew_peer_feedback"("crew_id", "author_user_id", "subject_user_id");

-- AddForeignKey
ALTER TABLE "crew_task_commitments" ADD CONSTRAINT "crew_task_commitments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "crew_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_participation_records" ADD CONSTRAINT "crew_participation_records_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_peer_feedback" ADD CONSTRAINT "crew_peer_feedback_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain invariants also hold for maintenance scripts and future writers.
ALTER TABLE "crew_task_commitments"
  ADD CONSTRAINT "crew_commitment_status_check" CHECK (status IN ('accepted', 'at_risk', 'withdrawn')),
  ADD CONSTRAINT "crew_commitment_promise_check" CHECK ((accepted_at IS NULL) = (promised_due_at IS NULL)),
  ADD CONSTRAINT "crew_commitment_acceptance_check" CHECK (status = 'withdrawn' OR accepted_at IS NOT NULL),
  ADD CONSTRAINT "crew_commitment_handover_check" CHECK ((released_at IS NULL) = (handover_note IS NULL));
ALTER TABLE "crew_participation_records"
  ADD CONSTRAINT "crew_participation_points_check" CHECK (community_points >= 0 AND community_points <= 50000),
  ADD CONSTRAINT "crew_participation_award_check" CHECK ((awarded_at IS NULL AND community_points = 0 AND awarded_by_user_id IS NULL) OR (awarded_at IS NOT NULL AND community_points > 0 AND awarded_by_user_id IS NOT NULL)),
  ADD CONSTRAINT "crew_participation_exit_check" CHECK ((withdrawal_at IS NULL) = (withdrawal_reason IS NULL)),
  ADD CONSTRAINT "crew_participation_resolution_check" CHECK (resolved_at IS NULL OR (withdrawal_at IS NOT NULL AND resolved_by_user_id IS NOT NULL AND resolution IS NOT NULL));
ALTER TABLE "crew_peer_feedback"
  ADD CONSTRAINT "crew_peer_rating_check" CHECK (rating BETWEEN 1 AND 5),
  ADD CONSTRAINT "crew_peer_no_self_review_check" CHECK (author_user_id <> subject_user_id);
