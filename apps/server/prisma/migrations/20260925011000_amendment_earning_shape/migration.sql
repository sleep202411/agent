ALTER TABLE crew_earning_entries DROP CONSTRAINT crew_earning_entries_source_shape_check;
ALTER TABLE crew_earning_entries ADD CONSTRAINT crew_earning_entries_source_shape_check CHECK (
 (amendment_id IS NOT NULL AND source_type='adjustment' AND task_id IS NOT NULL AND agreement_id IS NULL AND status IN ('posted','reversed')) OR
 (amendment_id IS NULL AND (
  (source_type='task_reward' AND task_id IS NOT NULL AND agreement_id IS NULL AND status IN ('posted','reversed')) OR
  (source_type='contract_compensation' AND task_id IS NULL AND agreement_id IS NOT NULL) OR
  (source_type NOT IN ('task_reward','contract_compensation') AND task_id IS NULL AND agreement_id IS NULL)
 ))
);
