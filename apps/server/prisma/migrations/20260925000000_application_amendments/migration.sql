CREATE TABLE crew_application_amendments (
  id uuid PRIMARY KEY,
  application_id text NOT NULL REFERENCES crew_applications(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES crew_tasks(id) ON DELETE RESTRICT,
  proposer_id text NOT NULL,
  applicant_id text NOT NULL,
  proposal jsonb NOT NULL,
  baseline jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','awaiting_settlement','effective','rejected','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  CHECK (proposer_id <> applicant_id)
);
CREATE UNIQUE INDEX crew_application_amendment_open ON crew_application_amendments(application_id) WHERE status IN ('pending','awaiting_settlement');
CREATE INDEX crew_application_amendment_history ON crew_application_amendments(application_id, created_at DESC, id DESC);
CREATE FUNCTION guard_crew_application_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Amendment history cannot be deleted'; END IF;
  IF (NEW.id,NEW.application_id,NEW.task_id,NEW.proposer_id,NEW.applicant_id,NEW.proposal,NEW.baseline,NEW.created_at) IS DISTINCT FROM
     (OLD.id,OLD.application_id,OLD.task_id,OLD.proposer_id,OLD.applicant_id,OLD.proposal,OLD.baseline,OLD.created_at)
  THEN RAISE EXCEPTION 'Amendment evidence is immutable'; END IF;
  IF NOT (OLD.status='pending' AND NEW.status IN ('awaiting_settlement','effective','rejected','withdrawn'))
  THEN RAISE EXCEPTION 'Invalid amendment transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crew_application_amendment_guard BEFORE UPDATE OR DELETE ON crew_application_amendments FOR EACH ROW EXECUTE FUNCTION guard_crew_application_amendment();
