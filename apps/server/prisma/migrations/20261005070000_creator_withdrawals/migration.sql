-- No balances are changed or converted by this migration.
CREATE TABLE creator_payout_accounts (
 id uuid PRIMARY KEY, user_id varchar(64) NOT NULL CONSTRAINT creator_payout_accounts_user_unique UNIQUE,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 details_encrypted text NOT NULL, display_label varchar(200) NOT NULL,
 created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE TABLE creator_withdrawals (
 id uuid PRIMARY KEY, user_id varchar(64) NOT NULL,
 request_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','rejected','cancelled')),
 percentage_bps integer NOT NULL CHECK(percentage_bps BETWEEN 1 AND 10000),
 available_amount_minor bigint NOT NULL CHECK(available_amount_minor>0),
 currency varchar(3) NOT NULL CHECK(currency IN ('USD','CNY')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 CONSTRAINT creator_withdrawals_percentage_amount CHECK(amount_minor = floor(available_amount_minor::numeric * percentage_bps / 10000)),
 recipient_encrypted text NOT NULL, recipient_label varchar(200) NOT NULL,
 processing_admin_id varchar(64), payment_reference varchar(180), paid_admin_id varchar(64), paid_at timestamptz(6),
 resolution_reason varchar(2000),
 created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
 CONSTRAINT creator_withdrawals_request_unique UNIQUE(user_id,request_id),
 CONSTRAINT creator_withdrawals_paid_evidence CHECK(
  (status='paid' AND paid_at IS NOT NULL AND paid_admin_id IS NOT NULL AND payment_reference IS NOT NULL AND length(trim(payment_reference))>0)
  OR (status<>'paid' AND paid_at IS NULL AND paid_admin_id IS NULL AND payment_reference IS NULL)
 ),
 CONSTRAINT creator_withdrawals_processing_owner CHECK(status NOT IN ('processing','paid') OR processing_admin_id IS NOT NULL),
 CONSTRAINT creator_withdrawals_resolution_reason CHECK(status NOT IN ('rejected','cancelled') OR (resolution_reason IS NOT NULL AND length(trim(resolution_reason))>0))
);
CREATE INDEX creator_withdrawals_user_recent_idx ON creator_withdrawals(user_id,created_at DESC,id);
CREATE INDEX creator_withdrawals_queue_idx ON creator_withdrawals(status,created_at,id);
CREATE TABLE creator_withdrawal_events (
 id uuid PRIMARY KEY, withdrawal_id uuid NOT NULL REFERENCES creator_withdrawals(id),
 actor_type varchar(16) NOT NULL CHECK(actor_type IN ('creator','admin')),
 actor_id varchar(64) NOT NULL, action varchar(32) NOT NULL,
 version integer NOT NULL CHECK(version>0), created_at timestamptz(6) NOT NULL DEFAULT now(),
 CONSTRAINT creator_withdrawal_events_version_unique UNIQUE(withdrawal_id,version)
);

-- Reuse the existing allocation ledger and its anti-double-payment constraints.
ALTER TABLE crew_payouts ADD COLUMN platform_withdrawal_id uuid REFERENCES creator_withdrawals(id) ON DELETE RESTRICT;
CREATE INDEX crew_payouts_platform_withdrawal_idx ON crew_payouts(platform_withdrawal_id);

-- A request and all of its Crew reservations form one accounting unit.
-- Deferred checks permit the service to settle/void every child atomically.
CREATE FUNCTION validate_creator_withdrawal_payouts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
 target uuid;
 parent creator_withdrawals%ROWTYPE;
 expected_status text;
 total numeric;
 invalid_count bigint;
BEGIN
 IF TG_TABLE_NAME='creator_withdrawals' THEN target := NEW.id;
 ELSE target := NEW.platform_withdrawal_id;
 END IF;
 IF target IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO parent FROM creator_withdrawals WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal parent missing'; END IF;
 expected_status := CASE WHEN parent.status='paid' THEN 'paid'
   WHEN parent.status IN ('cancelled','rejected') THEN 'voided' ELSE 'pending' END;
 SELECT COALESCE(SUM(amount_minor),0), COUNT(*) FILTER (WHERE
   user_id IS DISTINCT FROM parent.user_id OR currency IS DISTINCT FROM parent.currency
   OR status::text IS DISTINCT FROM expected_status OR withholding_amount_minor<>0
   OR net_amount_minor<>amount_minor)
 INTO total, invalid_count FROM crew_payouts WHERE platform_withdrawal_id=target;
 IF total<>parent.amount_minor OR invalid_count<>0 THEN
   RAISE EXCEPTION 'withdrawal reservations must match recipient, currency, amount and status'
     USING ERRCODE='integrity_constraint_violation';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER creator_withdrawals_payouts_consistent
 AFTER INSERT OR UPDATE ON creator_withdrawals DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION validate_creator_withdrawal_payouts();
CREATE CONSTRAINT TRIGGER crew_payouts_withdrawal_consistent
 AFTER INSERT OR UPDATE ON crew_payouts DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION validate_creator_withdrawal_payouts();

CREATE FUNCTION protect_creator_withdrawal_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.user_id,NEW.request_id,NEW.currency,NEW.amount_minor,
   NEW.percentage_bps,NEW.available_amount_minor,NEW.recipient_encrypted,NEW.recipient_label)
 IS DISTINCT FROM ROW(OLD.user_id,OLD.request_id,OLD.currency,OLD.amount_minor,
   OLD.percentage_bps,OLD.available_amount_minor,OLD.recipient_encrypted,OLD.recipient_label) THEN
   RAISE EXCEPTION 'withdrawal financial and recipient snapshot is immutable'
     USING ERRCODE='integrity_constraint_violation';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER creator_withdrawals_snapshot_immutable BEFORE UPDATE ON creator_withdrawals
 FOR EACH ROW EXECUTE FUNCTION protect_creator_withdrawal_snapshot();

CREATE FUNCTION protect_platform_withdrawal_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.platform_withdrawal_id IS DISTINCT FROM OLD.platform_withdrawal_id THEN
   RAISE EXCEPTION 'platform withdrawal binding is immutable'
     USING ERRCODE='integrity_constraint_violation';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER crew_payouts_withdrawal_binding_immutable BEFORE UPDATE ON crew_payouts
 FOR EACH ROW EXECUTE FUNCTION protect_platform_withdrawal_binding();
