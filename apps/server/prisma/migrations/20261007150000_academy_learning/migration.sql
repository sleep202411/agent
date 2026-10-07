CREATE TABLE academy_offerings (
 course_id varchar(128) PRIMARY KEY, teacher_id varchar(64) NOT NULL,
 price_credits bigint NOT NULL CHECK (price_credits >= 0),
 teacher_share_bps integer NOT NULL CHECK (teacher_share_bps BETWEEN 0 AND 10000),
 enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL
);
CREATE TABLE academy_enrollments (
 id uuid PRIMARY KEY, course_id varchar(128) NOT NULL, student_id varchar(64) NOT NULL,
 teacher_id varchar(64) NOT NULL, certificate_id integer NOT NULL CHECK (certificate_id > 0),
 price_credits bigint NOT NULL CHECK (price_credits >= 0),
 teacher_credits bigint NOT NULL CHECK (teacher_credits >= 0 AND teacher_credits <= price_credits),
 offering_version integer NOT NULL, status varchar(24) NOT NULL DEFAULT 'enrolled'
 CHECK (status IN ('enrolled','submitted','revision','approved')),
 version integer NOT NULL DEFAULT 1, description text, asset_ids uuid[] NOT NULL DEFAULT '{}',
 score integer CHECK (score BETWEEN 0 AND 100), feedback text, reviewed_at timestamptz,
 badge_issued_at timestamptz, badge_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL,
 UNIQUE (course_id,student_id), CHECK (teacher_id <> student_id)
);
CREATE INDEX academy_enrollments_teacher_id_status_created_at_idx ON academy_enrollments(teacher_id,status,created_at);
CREATE TABLE academy_enrollment_events (
 id uuid PRIMARY KEY, enrollment_id uuid NOT NULL REFERENCES academy_enrollments(id) ON DELETE RESTRICT,
 actor_id varchar(64) NOT NULL, version integer NOT NULL, kind varchar(24) NOT NULL,
 details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(enrollment_id,version)
);

CREATE TABLE academy_withdrawal_allocations (
 id uuid PRIMARY KEY,
 withdrawal_id uuid NOT NULL REFERENCES creator_withdrawals(id) ON DELETE RESTRICT,
 enrollment_id uuid NOT NULL REFERENCES academy_enrollments(id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL CHECK(amount_minor > 0),
 currency varchar(3) NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(withdrawal_id,enrollment_id)
);
CREATE INDEX academy_withdrawal_allocations_enrollment_id_idx ON academy_withdrawal_allocations(enrollment_id);

-- Preserve the existing cross-Crew reconciliation guard while including Academy.
CREATE OR REPLACE FUNCTION validate_creator_withdrawal_payouts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target uuid; parent creator_withdrawals%ROWTYPE; expected_status text;
 total numeric; invalid_count bigint; academy_total numeric; academy_invalid bigint;
BEGIN
 IF TG_TABLE_NAME='creator_withdrawals' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='academy_withdrawal_allocations' THEN target:=NEW.withdrawal_id;
 ELSE target:=NEW.platform_withdrawal_id; END IF;
 IF target IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO parent FROM creator_withdrawals WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal parent missing'; END IF;
 expected_status:=CASE WHEN parent.status='paid' THEN 'paid' WHEN parent.status IN ('cancelled','rejected') THEN 'voided' ELSE 'pending' END;
 SELECT COALESCE(SUM(amount_minor),0),COUNT(*) FILTER(WHERE user_id IS DISTINCT FROM parent.user_id OR currency IS DISTINCT FROM parent.currency OR status::text IS DISTINCT FROM expected_status OR withholding_amount_minor<>0 OR net_amount_minor<>amount_minor)
 INTO total,invalid_count FROM crew_payouts WHERE platform_withdrawal_id=target;
 PERFORM e.id FROM academy_enrollments e JOIN academy_withdrawal_allocations a ON a.enrollment_id=e.id WHERE a.withdrawal_id=target ORDER BY e.id FOR UPDATE OF e;
 SELECT COALESCE(SUM(a.amount_minor),0),COUNT(*) FILTER(WHERE e.teacher_id IS DISTINCT FROM parent.user_id OR parent.currency<>'USD' OR e.status<>'approved')
 INTO academy_total,academy_invalid FROM academy_withdrawal_allocations a JOIN academy_enrollments e ON e.id=a.enrollment_id WHERE a.withdrawal_id=target;
 IF total+academy_total<>parent.amount_minor OR invalid_count+academy_invalid<>0 THEN
 RAISE EXCEPTION 'withdrawal reservations must match recipient, currency, amount and status' USING ERRCODE='integrity_constraint_violation'; END IF;
 IF EXISTS(SELECT 1 FROM academy_enrollments e WHERE e.id IN (SELECT enrollment_id FROM academy_withdrawal_allocations WHERE withdrawal_id=target)
 AND e.teacher_credits < (SELECT COALESCE(SUM(a.amount_minor),0) FROM academy_withdrawal_allocations a JOIN creator_withdrawals w ON w.id=a.withdrawal_id WHERE a.enrollment_id=e.id AND w.status IN ('pending','processing','paid'))) THEN
 RAISE EXCEPTION 'Teaching earnings are already reserved or paid' USING ERRCODE='integrity_constraint_violation'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER academy_withdrawals_consistent AFTER INSERT ON academy_withdrawal_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_creator_withdrawal_payouts();
CREATE FUNCTION academy_allocation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Academy withdrawal allocations are immutable'; END; $$;
CREATE TRIGGER academy_allocation_immutable BEFORE UPDATE OR DELETE ON academy_withdrawal_allocations FOR EACH ROW EXECUTE FUNCTION academy_allocation_immutable();
CREATE FUNCTION academy_enrollment_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.course_id,NEW.student_id,NEW.teacher_id,NEW.certificate_id,NEW.price_credits,NEW.teacher_credits,NEW.offering_version) IS DISTINCT FROM
 (OLD.course_id,OLD.student_id,OLD.teacher_id,OLD.certificate_id,OLD.price_credits,OLD.teacher_credits,OLD.offering_version) THEN RAISE EXCEPTION 'Academy enrollment terms are immutable'; END IF;
 IF OLD.status='approved' AND NEW.status<>'approved' THEN RAISE EXCEPTION 'Approved Academy income cannot be unapproved'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER academy_enrollment_snapshot_guard BEFORE UPDATE ON academy_enrollments FOR EACH ROW EXECUTE FUNCTION academy_enrollment_snapshot_guard();
