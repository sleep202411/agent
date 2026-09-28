ALTER TABLE crew_earning_entries ADD COLUMN amendment_id uuid REFERENCES crew_application_amendments(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX crew_earning_amendment_unique ON crew_earning_entries(amendment_id);
DROP INDEX crew_earning_entries_task_user_source_unique;
CREATE UNIQUE INDEX crew_earning_entries_task_user_source_unique ON crew_earning_entries(task_id,user_id,source_type) WHERE amendment_id IS NULL;
CREATE INDEX crew_earning_entries_task_user_source_idx ON crew_earning_entries(task_id,user_id,source_type);
ALTER TABLE crew_earning_entries ADD CONSTRAINT crew_earning_amendment_source CHECK (amendment_id IS NULL OR (source_type='adjustment' AND task_id IS NOT NULL));
CREATE FUNCTION guard_crew_earning_amendment_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.amendment_id IS DISTINCT FROM OLD.amendment_id THEN RAISE EXCEPTION 'Amendment identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crew_earning_amendment_identity BEFORE UPDATE ON crew_earning_entries FOR EACH ROW EXECUTE FUNCTION guard_crew_earning_amendment_identity();
ALTER TABLE crew_application_amendments DROP CONSTRAINT crew_application_amendments_status_check;
ALTER TABLE crew_application_amendments ADD CONSTRAINT crew_application_amendments_status_check CHECK (status IN ('pending','awaiting_settlement','effective','rejected','withdrawn','settlement_requested'));
ALTER TABLE crew_application_amendments ADD COLUMN settled_by text, ADD COLUMN settled_at timestamptz, ADD COLUMN settlement jsonb;
CREATE OR REPLACE FUNCTION guard_crew_application_amendment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Amendment history cannot be deleted'; END IF;
  IF (NEW.id,NEW.application_id,NEW.task_id,NEW.proposer_id,NEW.applicant_id,NEW.proposal,NEW.baseline,NEW.created_at) IS DISTINCT FROM
     (OLD.id,OLD.application_id,OLD.task_id,OLD.proposer_id,OLD.applicant_id,OLD.proposal,OLD.baseline,OLD.created_at)
  THEN RAISE EXCEPTION 'Amendment evidence is immutable'; END IF;
  IF NOT ((OLD.status='pending' AND NEW.status IN ('awaiting_settlement','effective','rejected','withdrawn')) OR
    (OLD.status='awaiting_settlement' AND NEW.status IN ('effective','settlement_requested','rejected','withdrawn')))
  THEN RAISE EXCEPTION 'Invalid amendment transition'; END IF;
  IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN RAISE EXCEPTION 'Consent evidence is immutable'; END IF;
  RETURN NEW;
END $$;
