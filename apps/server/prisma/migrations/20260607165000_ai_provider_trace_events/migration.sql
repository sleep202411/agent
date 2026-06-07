-- CreateTable
CREATE TABLE "ai_provider_trace_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" TEXT NOT NULL,
    "attempt_id" TEXT,
    "provider" VARCHAR(64) NOT NULL,
    "endpoint_id" VARCHAR(180),
    "provider_request_id" VARCHAR(180),
    "event_type" VARCHAR(64) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "confidence" VARCHAR(24) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "offset_ms" INTEGER,
    "duration_ms" INTEGER,
    "title" VARCHAR(160),
    "description" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(220) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_trace_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_trace_events_idempotency_key_unique" ON "ai_provider_trace_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_provider_trace_events_job_timeline_idx" ON "ai_provider_trace_events"("job_id", "occurred_at" ASC);

-- CreateIndex
CREATE INDEX "ai_provider_trace_events_provider_request_idx" ON "ai_provider_trace_events"("provider", "provider_request_id");

-- AddForeignKey
ALTER TABLE "ai_provider_trace_events" ADD CONSTRAINT "ai_provider_trace_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_trace_events" ADD CONSTRAINT "ai_provider_trace_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "ai_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
