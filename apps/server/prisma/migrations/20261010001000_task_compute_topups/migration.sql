ALTER TABLE crew_compute_requests
  ADD COLUMN kind varchar(24) NOT NULL DEFAULT 'legacy_allowance',
  ADD COLUMN remaining_workload numeric(14,2),
  ADD COLUMN workload_unit varchar(16);
UPDATE crew_compute_requests SET kind = 'initial_allowance' WHERE request_key = task_id;
ALTER TABLE crew_compute_requests ADD CONSTRAINT crew_compute_topup_terms CHECK (
  kind IN ('legacy_allowance', 'initial_allowance', 'top_up') AND
  (kind <> 'top_up' OR (
    points BETWEEN 1 AND 500 AND remaining_workload IS NOT NULL AND remaining_workload > 0 AND
    workload_unit IS NOT NULL AND workload_unit IN ('minutes', 'hours', 'days', 'person_days', 'percent') AND
    (workload_unit <> 'percent' OR remaining_workload <= 100) AND request_key <> task_id
  ))
);
CREATE UNIQUE INDEX crew_compute_one_topup_per_task ON crew_compute_requests(task_id) WHERE kind = 'top_up';
