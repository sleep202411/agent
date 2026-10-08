ALTER TABLE academy_offerings
  ADD COLUMN instructor_shares jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE academy_enrollments
  ADD COLUMN instructor_shares jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION academy_enrollment_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.course_id,NEW.student_id,NEW.teacher_id,NEW.certificate_id,NEW.price_credits,NEW.teacher_credits,NEW.offering_version,NEW.instructor_shares) IS DISTINCT FROM
 (OLD.course_id,OLD.student_id,OLD.teacher_id,OLD.certificate_id,OLD.price_credits,OLD.teacher_credits,OLD.offering_version,OLD.instructor_shares) THEN RAISE EXCEPTION 'Academy enrollment terms are immutable'; END IF;
 IF OLD.status='approved' AND NEW.status<>'approved' THEN RAISE EXCEPTION 'Approved Academy income cannot be unapproved'; END IF;
 RETURN NEW;
END; $$;
