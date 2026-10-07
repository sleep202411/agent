CREATE TABLE referral_withdrawal_allocations (
 id uuid PRIMARY KEY, withdrawal_id uuid NOT NULL REFERENCES creator_withdrawals(id) ON DELETE RESTRICT,
 reward_item_id uuid NOT NULL REFERENCES referral_reward_items(id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL CHECK(amount_minor>0), currency varchar(3) NOT NULL CHECK(currency IN ('USD','CNY')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(withdrawal_id,reward_item_id)
);
CREATE INDEX referral_withdrawal_allocations_reward_item_id_idx ON referral_withdrawal_allocations(reward_item_id);
CREATE OR REPLACE FUNCTION validate_creator_withdrawal_payouts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target uuid; parent creator_withdrawals%ROWTYPE; expected_status text;
 total numeric; invalid_count bigint; academy_total numeric; academy_invalid bigint; referral_total numeric; referral_invalid bigint;
BEGIN
 IF TG_TABLE_NAME='creator_withdrawals' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME IN ('academy_withdrawal_allocations','referral_withdrawal_allocations') THEN target:=NEW.withdrawal_id;
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
 PERFORM i.id FROM referral_reward_items i JOIN referral_withdrawal_allocations a ON a.reward_item_id=i.id WHERE a.withdrawal_id=target ORDER BY i.id FOR UPDATE OF i;
 SELECT COALESCE(SUM(a.amount_minor),0),COUNT(*) FILTER(WHERE r.user_id IS DISTINCT FROM parent.user_id OR a.currency IS DISTINCT FROM parent.currency OR COALESCE(i.currency,r.currency) IS DISTINCT FROM parent.currency OR i.payout_type<>'cash' OR i.granted_at IS NULL OR r.status<>'paid_out')
 INTO referral_total,referral_invalid FROM referral_withdrawal_allocations a JOIN referral_reward_items i ON i.id=a.reward_item_id JOIN referral_rewards r ON r.id=i.reward_id WHERE a.withdrawal_id=target;
 IF EXISTS(SELECT 1 FROM referral_reward_items i WHERE i.id IN (SELECT reward_item_id FROM referral_withdrawal_allocations WHERE withdrawal_id=target)
 AND i.amount_minor < (SELECT COALESCE(SUM(a.amount_minor),0) FROM referral_withdrawal_allocations a JOIN creator_withdrawals w ON w.id=a.withdrawal_id WHERE a.reward_item_id=i.id AND w.status IN ('pending','processing','paid'))) THEN
 RAISE EXCEPTION 'Referral earnings are already reserved or paid' USING ERRCODE='integrity_constraint_violation'; END IF;
 IF total+academy_total+referral_total<>parent.amount_minor OR invalid_count+academy_invalid+referral_invalid<>0 THEN
 RAISE EXCEPTION 'withdrawal reservations must match recipient, currency, amount and status' USING ERRCODE='integrity_constraint_violation'; END IF;
 IF EXISTS(SELECT 1 FROM academy_enrollments e WHERE e.id IN (SELECT enrollment_id FROM academy_withdrawal_allocations WHERE withdrawal_id=target)
 AND e.teacher_credits < (SELECT COALESCE(SUM(a.amount_minor),0) FROM academy_withdrawal_allocations a JOIN creator_withdrawals w ON w.id=a.withdrawal_id WHERE a.enrollment_id=e.id AND w.status IN ('pending','processing','paid'))) THEN
 RAISE EXCEPTION 'Teaching earnings are already reserved or paid' USING ERRCODE='integrity_constraint_violation'; END IF;
 RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER referral_withdrawals_consistent AFTER INSERT ON referral_withdrawal_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_creator_withdrawal_payouts();
CREATE TRIGGER referral_allocation_immutable BEFORE UPDATE OR DELETE ON referral_withdrawal_allocations FOR EACH ROW EXECUTE FUNCTION academy_allocation_immutable();
CREATE FUNCTION referral_item_cash_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.granted_at IS NOT NULL AND (NEW.reward_id,NEW.payout_type,NEW.amount_minor,NEW.currency,NEW.granted_at) IS DISTINCT FROM (OLD.reward_id,OLD.payout_type,OLD.amount_minor,OLD.currency,OLD.granted_at) THEN RAISE EXCEPTION 'Granted referral income is immutable'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER referral_item_cash_guard BEFORE UPDATE ON referral_reward_items FOR EACH ROW EXECUTE FUNCTION referral_item_cash_guard();
CREATE FUNCTION referral_reward_cash_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM referral_reward_items WHERE reward_id=OLD.id AND granted_at IS NOT NULL) AND ((NEW.user_id,NEW.currency) IS DISTINCT FROM (OLD.user_id,OLD.currency) OR (OLD.status='paid_out' AND NEW.status<>'paid_out')) THEN RAISE EXCEPTION 'Granted referral beneficiary and currency are immutable'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER referral_reward_cash_guard BEFORE UPDATE ON referral_rewards FOR EACH ROW EXECUTE FUNCTION referral_reward_cash_guard();
