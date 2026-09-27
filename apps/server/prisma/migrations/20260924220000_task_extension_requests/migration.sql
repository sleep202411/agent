CREATE TABLE crew_task_extension_requests (
 id UUID PRIMARY KEY,
 task_id UUID NOT NULL REFERENCES crew_tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 requester_user_id VARCHAR(64) NOT NULL,
 task_version INTEGER NOT NULL CHECK (task_version > 0),
 previous_due_at TIMESTAMPTZ NOT NULL,
 requested_due_at TIMESTAMPTZ NOT NULL,
 reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 4000),
 status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
 decided_by_user_id VARCHAR(64),
 decision_reason TEXT,
 decided_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (requested_due_at > previous_due_at),
 CHECK ((status = 'pending' AND decided_at IS NULL AND decided_by_user_id IS NULL AND decision_reason IS NULL)
 OR (status <> 'pending' AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL AND decision_reason IS NOT NULL AND length(trim(decision_reason)) BETWEEN 1 AND 4000))
);
CREATE INDEX crew_task_extension_requests_task_id_created_at_id_idx ON crew_task_extension_requests(task_id,created_at,id);
CREATE UNIQUE INDEX crew_task_extension_requests_pending_unique ON crew_task_extension_requests(task_id,requester_user_id) WHERE status='pending';
