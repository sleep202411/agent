ALTER TABLE "crew_compute_requests" ADD COLUMN "decided_by_admin_id" uuid;
-- Preserve historical user decisions, but distinguish all new Admin decisions.
ALTER TABLE "crew_compute_requests" DROP CONSTRAINT "crew_compute_requests_decision_check";
ALTER TABLE "crew_compute_requests" ADD CONSTRAINT "crew_compute_requests_decision_check" CHECK (
  (status = 'pending' AND decided_at IS NULL AND decided_by_user_id IS NULL AND decided_by_admin_id IS NULL)
  OR (status <> 'pending' AND decided_at IS NOT NULL AND
    ((decided_by_user_id IS NOT NULL AND decided_by_admin_id IS NULL) OR
     (decided_by_user_id IS NULL AND decided_by_admin_id IS NOT NULL)))
);
