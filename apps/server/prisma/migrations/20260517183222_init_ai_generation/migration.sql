-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_level" TEXT,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "deployment" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_id" TEXT,
    "input" JSONB NOT NULL,
    "normalized_input" JSONB NOT NULL,
    "error" JSONB,
    "logs" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "queue_position" INTEGER,
    "progress" DOUBLE PRECISION,
    "estimated_wait_seconds" INTEGER,
    "estimated_run_seconds" INTEGER,
    "estimated_total_seconds" INTEGER,
    "eta_confidence" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "retry_of_job_id" TEXT,
    "provider_job_id" TEXT,
    "cost" JSONB,
    "trace" JSONB,
    "client_ip" TEXT,
    "user_agent" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queued_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "provider_submitted_at" TIMESTAMPTZ(6),
    "provider_started_at" TIMESTAMPTZ(6),
    "provider_completed_at" TIMESTAMPTZ(6),
    "output_fetched_at" TIMESTAMPTZ(6),
    "oss_uploaded_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_outputs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "storage_path" TEXT NOT NULL,
    "content_hash" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration_seconds" INTEGER,
    "mime_type" TEXT,
    "bytes" INTEGER,
    "output_index" INTEGER NOT NULL,
    "seed" BIGINT,
    "safety_flags" JSONB,
    "provenance" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_attempts" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "provider_status" INTEGER,
    "provider_request" JSONB,
    "provider_request_headers" JSONB,
    "provider_response" JSONB,
    "provider_response_headers" JSONB,
    "provider_logs" JSONB,
    "cost_accounting" JSONB,
    "error" JSONB,
    "run_duration_ms" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "processing_error" TEXT,

    CONSTRAINT "ai_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_event_outbox" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dispatched_at" TIMESTAMPTZ(6),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_jobs_user_created_idx" ON "ai_jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_jobs_queue_claim_idx" ON "ai_jobs"("queue_name", "status", "queued_at");

-- CreateIndex
CREATE INDEX "ai_jobs_deleted_at_idx" ON "ai_jobs"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_jobs_idempotency_unique" ON "ai_jobs"("user_id", "model_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "ai_outputs_job_idx" ON "ai_outputs"("job_id");

-- CreateIndex
CREATE INDEX "ai_outputs_content_hash_idx" ON "ai_outputs"("content_hash");

-- CreateIndex
CREATE INDEX "ai_outputs_deleted_at_idx" ON "ai_outputs"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_outputs_job_index_unique" ON "ai_outputs"("job_id", "output_index");

-- CreateIndex
CREATE INDEX "ai_attempts_job_idx" ON "ai_attempts"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_attempts_job_attempt_unique" ON "ai_attempts"("job_id", "attempt_number");

-- CreateIndex
CREATE INDEX "ai_provider_events_job_recent_idx" ON "ai_provider_events"("job_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "ai_provider_events_pending_idx" ON "ai_provider_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_events_provider_event_unique" ON "ai_provider_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "ai_event_outbox_pending_idx" ON "ai_event_outbox"("dispatched_at", "created_at");

-- AddForeignKey
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_attempts" ADD CONSTRAINT "ai_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_event_outbox" ADD CONSTRAINT "ai_event_outbox_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
