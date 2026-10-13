-- Align persistence with the approved 3,000-point task top-up API/UI limit.
-- Replace atomically: retain workload, request-key and kind validation.
ALTER TABLE crew_compute_requests
  DROP CONSTRAINT crew_compute_topup_terms,
  ADD CONSTRAINT crew_compute_topup_terms CHECK (
    kind IN ('legacy_allowance', 'initial_allowance', 'top_up') AND
    (kind <> 'top_up' OR (
      points BETWEEN 1 AND 3000 AND remaining_workload IS NOT NULL AND remaining_workload > 0 AND
      workload_unit IS NOT NULL AND workload_unit IN ('minutes', 'hours', 'days', 'person_days', 'percent') AND
      (workload_unit <> 'percent' OR remaining_workload <= 100) AND request_key <> task_id
    ))
  );
