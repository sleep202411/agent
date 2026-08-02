-- Remove pre-launch finance and task duplication, then make crew ownership
-- part of every cross-entity foreign key that carries crew_id.

BEGIN;

-- A workflow state's semantic is the task lifecycle source of truth.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "crew_tasks" task
    JOIN "crew_task_workflow_states" state ON state."id" = task."workflow_state_id"
    WHERE task."status" IS DISTINCT FROM state."semantic"
  ) THEN
    RAISE EXCEPTION 'crew task status differs from workflow semantic';
  END IF;
END;
$$;

DROP INDEX IF EXISTS "crew_tasks_crew_status_idx";
ALTER TABLE "crew_tasks" DROP COLUMN "status";

-- Composite targets used by crew-bound foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS "crew_members_id_crew_user_unique"
  ON "crew_members"("id", "crew_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crew_task_cycles_id_crew_unique"
  ON "crew_task_cycles"("id", "crew_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crew_task_labels_id_crew_unique"
  ON "crew_task_labels"("id", "crew_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crew_agreements_id_crew_unique"
  ON "crew_agreements"("id", "crew_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crew_earning_entries_id_crew_unique"
  ON "crew_earning_entries"("id", "crew_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crew_payouts_id_crew_unique"
  ON "crew_payouts"("id", "crew_id");

ALTER TABLE "crew_tasks" DROP CONSTRAINT IF EXISTS "crew_tasks_parent_id_fkey";
ALTER TABLE "crew_tasks" ADD CONSTRAINT "crew_tasks_parent_id_crew_id_fkey"
  FOREIGN KEY ("parent_id", "crew_id") REFERENCES "crew_tasks"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_tasks" DROP CONSTRAINT IF EXISTS "crew_tasks_cycle_id_fkey";
ALTER TABLE "crew_tasks" ADD CONSTRAINT "crew_tasks_cycle_id_crew_id_fkey"
  FOREIGN KEY ("cycle_id", "crew_id") REFERENCES "crew_task_cycles"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crew_production_pages" DROP CONSTRAINT IF EXISTS "crew_production_pages_lead_member_id_fkey";
ALTER TABLE "crew_production_pages" ADD CONSTRAINT "crew_production_pages_lead_member_id_crew_id_fkey"
  FOREIGN KEY ("lead_member_id", "crew_id") REFERENCES "crew_members"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_production_resources" DROP CONSTRAINT IF EXISTS "crew_production_resources_asset_node_id_fkey";
ALTER TABLE "crew_production_resources" ADD CONSTRAINT "crew_production_resources_asset_node_id_crew_id_fkey"
  FOREIGN KEY ("asset_node_id", "crew_id") REFERENCES "crew_asset_nodes"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_production_label_assignments" DROP CONSTRAINT IF EXISTS "crew_production_label_assignments_label_id_fkey";
ALTER TABLE "crew_production_label_assignments" ADD CONSTRAINT "crew_production_label_assignments_label_id_crew_id_fkey"
  FOREIGN KEY ("label_id", "crew_id") REFERENCES "crew_task_labels"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crew_task_label_assignments" ADD COLUMN "crew_id" TEXT;
UPDATE "crew_task_label_assignments" assignment
SET "crew_id" = task."crew_id"
FROM "crew_tasks" task
WHERE task."id" = assignment."task_id";
ALTER TABLE "crew_task_label_assignments" ALTER COLUMN "crew_id" SET NOT NULL;
ALTER TABLE "crew_task_label_assignments" DROP CONSTRAINT IF EXISTS "crew_task_label_assignments_task_id_fkey";
ALTER TABLE "crew_task_label_assignments" DROP CONSTRAINT IF EXISTS "crew_task_label_assignments_label_id_fkey";
ALTER TABLE "crew_task_label_assignments" ADD CONSTRAINT "crew_task_label_assignments_task_id_crew_id_fkey"
  FOREIGN KEY ("task_id", "crew_id") REFERENCES "crew_tasks"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_label_assignments" ADD CONSTRAINT "crew_task_label_assignments_label_id_crew_id_fkey"
  FOREIGN KEY ("label_id", "crew_id") REFERENCES "crew_task_labels"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crew_task_assignees" ADD COLUMN "crew_id" TEXT;
UPDATE "crew_task_assignees" assignee
SET "crew_id" = task."crew_id"
FROM "crew_tasks" task
WHERE task."id" = assignee."task_id";
ALTER TABLE "crew_task_assignees" ALTER COLUMN "crew_id" SET NOT NULL;
ALTER TABLE "crew_task_assignees" DROP CONSTRAINT IF EXISTS "crew_task_assignees_task_id_fkey";
ALTER TABLE "crew_task_assignees" DROP CONSTRAINT IF EXISTS "crew_task_assignees_crew_member_id_fkey";
ALTER TABLE "crew_task_assignees" ADD CONSTRAINT "crew_task_assignees_task_id_crew_id_fkey"
  FOREIGN KEY ("task_id", "crew_id") REFERENCES "crew_tasks"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_assignees" ADD CONSTRAINT "crew_task_assignees_crew_member_id_crew_id_user_id_fkey"
  FOREIGN KEY ("crew_member_id", "crew_id", "user_id") REFERENCES "crew_members"("id", "crew_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crew_earning_entries" DROP CONSTRAINT IF EXISTS "crew_earning_entries_member_id_fkey";
ALTER TABLE "crew_earning_entries" DROP CONSTRAINT IF EXISTS "crew_earning_entries_task_id_fkey";
ALTER TABLE "crew_earning_entries" DROP CONSTRAINT IF EXISTS "crew_earning_entries_agreement_id_fkey";
ALTER TABLE "crew_earning_entries" ADD CONSTRAINT "crew_earning_entries_crew_member_id_crew_id_user_id_fkey"
  FOREIGN KEY ("crew_member_id", "crew_id", "user_id") REFERENCES "crew_members"("id", "crew_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_earning_entries" ADD CONSTRAINT "crew_earning_entries_task_id_crew_id_fkey"
  FOREIGN KEY ("task_id", "crew_id") REFERENCES "crew_tasks"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_earning_entries" ADD CONSTRAINT "crew_earning_entries_agreement_id_crew_id_fkey"
  FOREIGN KEY ("agreement_id", "crew_id") REFERENCES "crew_agreements"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crew_payouts" DROP CONSTRAINT IF EXISTS "crew_payouts_member_id_fkey";
ALTER TABLE "crew_payouts" ADD CONSTRAINT "crew_payouts_crew_member_id_crew_id_user_id_fkey"
  FOREIGN KEY ("crew_member_id", "crew_id", "user_id") REFERENCES "crew_members"("id", "crew_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_payout_allocations" DROP CONSTRAINT IF EXISTS "crew_payout_allocations_payout_id_fkey";
ALTER TABLE "crew_payout_allocations" DROP CONSTRAINT IF EXISTS "crew_payout_allocations_earning_id_fkey";
ALTER TABLE "crew_payout_allocations" ADD CONSTRAINT "crew_payout_allocations_payout_id_crew_id_fkey"
  FOREIGN KEY ("payout_id", "crew_id") REFERENCES "crew_payouts"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_payout_allocations" ADD CONSTRAINT "crew_payout_allocations_earning_id_crew_id_fkey"
  FOREIGN KEY ("earning_id", "crew_id") REFERENCES "crew_earning_entries"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_earning_events" DROP CONSTRAINT IF EXISTS "crew_earning_events_earning_id_fkey";
ALTER TABLE "crew_earning_events" ADD CONSTRAINT "crew_earning_events_earning_id_crew_id_fkey"
  FOREIGN KEY ("earning_id", "crew_id") REFERENCES "crew_earning_entries"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_payout_events" DROP CONSTRAINT IF EXISTS "crew_payout_events_payout_id_fkey";
ALTER TABLE "crew_payout_events" ADD CONSTRAINT "crew_payout_events_payout_id_crew_id_fkey"
  FOREIGN KEY ("payout_id", "crew_id") REFERENCES "crew_payouts"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
