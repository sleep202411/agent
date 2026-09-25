CREATE TABLE crew_task_disputes (
 id UUID PRIMARY KEY,
 task_id UUID NOT NULL REFERENCES crew_tasks(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 opened_by_user_id VARCHAR(64) NOT NULL,
 respondent_user_id VARCHAR(64) NOT NULL,
 title VARCHAR(180) NOT NULL CHECK (length(trim(title)) > 0),
 status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','appealed')),
 owner_admin_id UUID,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (opened_by_user_id <> respondent_user_id),
 CHECK ((status IN ('open','appealed') AND owner_admin_id IS NULL) OR (status IN ('in_review','resolved') AND owner_admin_id IS NOT NULL))
);
CREATE INDEX crew_task_disputes_opened_by_user_id_created_at_id_idx ON crew_task_disputes(opened_by_user_id,created_at,id);
CREATE INDEX crew_task_disputes_respondent_user_id_created_at_id_idx ON crew_task_disputes(respondent_user_id,created_at,id);
CREATE INDEX crew_task_disputes_status_created_at_id_idx ON crew_task_disputes(status,created_at,id);
CREATE UNIQUE INDEX crew_task_disputes_pending_pair ON crew_task_disputes(task_id,LEAST(opened_by_user_id,respondent_user_id),GREATEST(opened_by_user_id,respondent_user_id)) WHERE status <> 'resolved';
CREATE TABLE crew_task_dispute_events (
 id UUID PRIMARY KEY,
 dispute_id UUID NOT NULL REFERENCES crew_task_disputes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 version INTEGER NOT NULL CHECK (version > 0),
 request_key UUID NOT NULL,
 fingerprint VARCHAR(64) NOT NULL,
 actor_id VARCHAR(64) NOT NULL,
 actor_kind VARCHAR(16) NOT NULL CHECK (actor_kind IN ('user','admin')),
 action VARCHAR(16) NOT NULL CHECK (action IN ('open','message','claim','resolve','appeal')),
 message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 4000),
 submission_ids UUID[] NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(dispute_id,version), UNIQUE(dispute_id,request_key)
);
CREATE FUNCTION guard_crew_dispute_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Dispute history is immutable'; END;
$$;
CREATE TRIGGER crew_dispute_event_immutable BEFORE UPDATE OR DELETE ON crew_task_dispute_events FOR EACH ROW EXECUTE FUNCTION guard_crew_dispute_event();
