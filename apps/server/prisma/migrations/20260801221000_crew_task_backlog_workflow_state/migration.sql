-- Backlog is a first-class planning state while retaining the stable `open`
-- lifecycle semantic used by task execution rules.
ALTER TABLE "crew_task_workflow_states"
  DROP CONSTRAINT "crew_task_workflow_states_system_key_check",
  DROP CONSTRAINT "crew_task_workflow_states_system_semantic_check";

ALTER TABLE "crew_task_workflow_states"
  ADD CONSTRAINT "crew_task_workflow_states_system_key_check"
    CHECK (
      "system_key" IS NULL OR
      "system_key" IN (
        'backlog',
        'open',
        'in_progress',
        'submitted',
        'revision_requested',
        'approved',
        'cancelled'
      )
    ),
  ADD CONSTRAINT "crew_task_workflow_states_system_semantic_check"
    CHECK (
      "system_key" IS NULL OR
      ("system_key" = 'backlog' AND "semantic" = 'open') OR
      "system_key" = "semantic"::text
    );
