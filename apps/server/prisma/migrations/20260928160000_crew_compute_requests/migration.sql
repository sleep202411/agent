CREATE TABLE "crew_compute_requests" (
 "id" UUID NOT NULL PRIMARY KEY,
 "crew_id" TEXT NOT NULL,
 "task_id" UUID NOT NULL,
 "workspace_id" UUID NOT NULL,
 "user_id" VARCHAR(64) NOT NULL,
 "task_title" VARCHAR(180) NOT NULL,
 "points" INTEGER NOT NULL CHECK ("points" > 0 AND "points" <= 2000000000),
 "reason" TEXT NOT NULL,
 "status" VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','approved','rejected')),
 "decided_by_user_id" VARCHAR(64),
 "decision_note" TEXT,
 "decided_at" TIMESTAMPTZ(6),
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "request_key" UUID NOT NULL,
 CONSTRAINT "crew_compute_requests_task_id_crew_id_fkey" FOREIGN KEY ("task_id", "crew_id") REFERENCES "crew_tasks"("id", "crew_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "crew_compute_requests_decision_check" CHECK (("status" = 'pending' AND "decided_at" IS NULL AND "decided_by_user_id" IS NULL) OR ("status" <> 'pending' AND "decided_at" IS NOT NULL AND "decided_by_user_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "crew_compute_requests_crew_user_key_unique" ON "crew_compute_requests"("crew_id", "user_id", "request_key");
CREATE INDEX "crew_compute_requests_crew_id_created_at_id_idx" ON "crew_compute_requests"("crew_id", "created_at", "id");
CREATE INDEX "crew_compute_requests_task_id_user_id_status_idx" ON "crew_compute_requests"("task_id", "user_id", "status");
