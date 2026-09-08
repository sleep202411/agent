ALTER TABLE crew_task_assignees ADD COLUMN currency VARCHAR(6) NOT NULL DEFAULT 'POINTS';
ALTER TABLE crew_task_assignees ADD CONSTRAINT crew_task_assignees_currency_check CHECK (currency IN ('POINTS', 'CNY', 'USD'));
ALTER TABLE crew_earning_entries ADD COLUMN currency VARCHAR(6) NOT NULL DEFAULT 'POINTS';
ALTER TABLE crew_earning_entries ADD CONSTRAINT crew_earning_entries_currency_check CHECK (currency IN ('POINTS', 'CNY', 'USD'));
ALTER TABLE crew_payouts ADD COLUMN currency VARCHAR(6) NOT NULL DEFAULT 'POINTS';
ALTER TABLE crew_payouts ADD CONSTRAINT crew_payouts_currency_check CHECK (currency IN ('POINTS', 'CNY', 'USD'));

CREATE FUNCTION guard_crew_ledger_currency_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.currency IS DISTINCT FROM OLD.currency THEN
  RAISE EXCEPTION 'Crew ledger currency is immutable' USING ERRCODE = 'integrity_constraint_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER crew_earning_currency_immutable BEFORE UPDATE ON crew_earning_entries FOR EACH ROW EXECUTE FUNCTION guard_crew_ledger_currency_update();
CREATE TRIGGER crew_payout_currency_immutable BEFORE UPDATE ON crew_payouts FOR EACH ROW EXECUTE FUNCTION guard_crew_ledger_currency_update();
CREATE FUNCTION guard_crew_allocation_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT currency FROM crew_earning_entries WHERE id = NEW.earning_id)
 IS DISTINCT FROM (SELECT currency FROM crew_payouts WHERE id = NEW.payout_id) THEN
  RAISE EXCEPTION 'Crew payout and earning currency mismatch' USING ERRCODE = 'integrity_constraint_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER crew_allocation_currency_match BEFORE INSERT ON crew_payout_allocations FOR EACH ROW EXECUTE FUNCTION guard_crew_allocation_currency();
