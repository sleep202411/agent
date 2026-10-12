CREATE TABLE "crew_task_creation_requests" (
 "id" UUID NOT NULL,
 "crew_id" VARCHAR(64) NOT NULL,
 "requester_id" VARCHAR(64) NOT NULL,
 "kind" VARCHAR(32) NOT NULL,
 "input" JSONB NOT NULL,
 "request_key" VARCHAR(128) NOT NULL,
 "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
 "result" JSONB,
 "decision_note" TEXT,
 "decided_by_admin_id" UUID,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "decided_at" TIMESTAMPTZ(6),
 CONSTRAINT "crew_task_creation_requests_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "crew_task_creation_requests_status_check" CHECK ("status" IN ('pending','approved','rejected'))
);
CREATE UNIQUE INDEX "crew_task_creation_requests_crew_id_requester_id_request_key_key" ON "crew_task_creation_requests"("crew_id", "requester_id", "request_key");
CREATE INDEX "crew_task_creation_requests_status_created_at_id_idx" ON "crew_task_creation_requests"("status", "created_at", "id");
