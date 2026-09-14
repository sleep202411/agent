-- One historical Crew point was one USD cent. Relabel it as USD without
-- changing amounts, statuses, versions, allocations, or the append-only audit.
-- Deploy with the matching server/web contract; this migration renames columns.
BEGIN;
LOCK TABLE crew_task_assignees, crew_earning_entries, crew_payouts,
  crew_payout_allocations IN ACCESS EXCLUSIVE MODE;

ALTER TABLE crew_earning_entries DISABLE TRIGGER crew_earning_entries_guard_update;
ALTER TABLE crew_earning_entries DISABLE TRIGGER crew_earning_currency_immutable;
ALTER TABLE crew_payouts DISABLE TRIGGER crew_payouts_guard_update;
ALTER TABLE crew_payouts DISABLE TRIGGER crew_payout_currency_immutable;

UPDATE crew_task_assignees SET currency = 'USD' WHERE currency = 'POINTS';
UPDATE crew_earning_entries SET currency = 'USD' WHERE currency = 'POINTS';
UPDATE crew_payouts SET currency = 'USD' WHERE currency = 'POINTS';

ALTER TABLE crew_earning_entries ENABLE TRIGGER crew_earning_entries_guard_update;
ALTER TABLE crew_earning_entries ENABLE TRIGGER crew_earning_currency_immutable;
ALTER TABLE crew_payouts ENABLE TRIGGER crew_payouts_guard_update;
ALTER TABLE crew_payouts ENABLE TRIGGER crew_payout_currency_immutable;

ALTER TABLE crew_task_assignees
  DROP CONSTRAINT crew_task_assignees_currency_check,
  ALTER COLUMN currency DROP DEFAULT,
  ALTER COLUMN currency TYPE VARCHAR(3),
  ADD CONSTRAINT crew_task_assignees_currency_check CHECK (currency IN ('CNY', 'USD'));
ALTER TABLE crew_earning_entries
  DROP CONSTRAINT crew_earning_entries_currency_check,
  ALTER COLUMN currency DROP DEFAULT,
  ALTER COLUMN currency TYPE VARCHAR(3),
  ADD CONSTRAINT crew_earning_entries_currency_check CHECK (currency IN ('CNY', 'USD'));
ALTER TABLE crew_payouts
  DROP CONSTRAINT crew_payouts_currency_check,
  ALTER COLUMN currency DROP DEFAULT,
  ALTER COLUMN currency TYPE VARCHAR(3),
  ADD CONSTRAINT crew_payouts_currency_check CHECK (currency IN ('CNY', 'USD'));

ALTER TABLE crew_task_assignees RENAME COLUMN reward_points TO reward_amount_minor;
ALTER TABLE crew_earning_entries RENAME COLUMN points_amount TO amount_minor;
ALTER TABLE crew_payouts RENAME COLUMN points_amount TO amount_minor;
ALTER TABLE crew_payout_allocations RENAME COLUMN points_amount TO amount_minor;
ALTER TABLE crew_payout_allocations RENAME CONSTRAINT crew_payout_allocations_points_check TO crew_payout_allocations_amount_check;

CREATE OR REPLACE FUNCTION guard_crew_earning_entry_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."id",
    NEW."crew_id",
    NEW."crew_member_id",
    NEW."user_id",
    NEW."source_type",
    NEW."task_id",
    NEW."agreement_id",
    NEW."title",
    NEW."description",
    NEW."amount_minor",
    NEW."idempotency_key",
    NEW."created_by_user_id",
    NEW."created_at"
  ) IS DISTINCT FROM (
    OLD."id",
    OLD."crew_id",
    OLD."crew_member_id",
    OLD."user_id",
    OLD."source_type",
    OLD."task_id",
    OLD."agreement_id",
    OLD."title",
    OLD."description",
    OLD."amount_minor",
    OLD."idempotency_key",
    OLD."created_by_user_id",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'crew earning source fields are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'crew earning version must increment exactly once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NOT (
    (OLD."status" = 'pending' AND NEW."status" IN ('posted', 'rejected'))
    OR (OLD."status" = 'posted' AND NEW."status" = 'reversed')
  ) THEN
    RAISE EXCEPTION 'invalid crew earning transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD."status" = 'posted' AND NEW."status" = 'reversed' AND EXISTS (
    SELECT 1
    FROM "crew_payout_allocations" allocation
    JOIN "crew_payouts" payout ON payout."id" = allocation."payout_id"
    WHERE allocation."earning_id" = OLD."id"
      AND payout."status" IN ('pending', 'paid')
  ) THEN
    RAISE EXCEPTION 'allocated crew earning cannot be reversed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_crew_payout_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."id", NEW."crew_id", NEW."crew_member_id", NEW."user_id",
    NEW."amount_minor", NEW."withholding_amount_minor",
    NEW."net_amount_minor", NEW."note", NEW."idempotency_key",
    NEW."created_by_user_id", NEW."created_at"
  ) IS DISTINCT FROM (
    OLD."id", OLD."crew_id", OLD."crew_member_id", OLD."user_id",
    OLD."amount_minor", OLD."withholding_amount_minor",
    OLD."net_amount_minor", OLD."note", OLD."idempotency_key",
    OLD."created_by_user_id", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'crew payout financial snapshot is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'crew payout version must increment exactly once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NOT (
    (OLD."status" = 'pending' AND NEW."status" IN ('paid', 'voided'))
  ) THEN
    RAISE EXCEPTION 'invalid crew payout transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_crew_payout_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  earning_amount BIGINT;
  earning_crew TEXT;
  earning_user VARCHAR(64);
  payout_crew TEXT;
  payout_user VARCHAR(64);
  allocated_amount BIGINT;
BEGIN
  SELECT "amount_minor", "crew_id", "user_id"
    INTO earning_amount, earning_crew, earning_user
  FROM "crew_earning_entries"
  WHERE "id" = NEW."earning_id" AND "status" = 'posted'
  FOR UPDATE;

  IF earning_amount IS NULL THEN
    RAISE EXCEPTION 'payout allocation requires a posted earning'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT "crew_id", "user_id" INTO payout_crew, payout_user
  FROM "crew_payouts" WHERE "id" = NEW."payout_id";

  IF payout_crew IS DISTINCT FROM earning_crew OR payout_user IS DISTINCT FROM earning_user THEN
    RAISE EXCEPTION 'payout allocation member or crew mismatch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."crew_id" IS DISTINCT FROM payout_crew THEN
    RAISE EXCEPTION 'payout allocation crew mismatch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT COALESCE(SUM(allocation."amount_minor"), 0)
    INTO allocated_amount
  FROM "crew_payout_allocations" allocation
  JOIN "crew_payouts" payout ON payout."id" = allocation."payout_id"
  WHERE allocation."earning_id" = NEW."earning_id"
    AND payout."status" IN ('pending', 'paid');

  IF allocated_amount + NEW."amount_minor" > earning_amount THEN
    RAISE EXCEPTION 'payout allocations exceed earning amount'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_crew_payout_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_payout_id UUID;
  expected_amount BIGINT;
  actual_amount BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'crew_payouts' THEN
    target_payout_id := NEW."id";
  ELSE
    target_payout_id := NEW."payout_id";
  END IF;
  SELECT "amount_minor" INTO expected_amount FROM "crew_payouts" WHERE "id" = target_payout_id;
  SELECT COALESCE(SUM("amount_minor"), 0) INTO actual_amount
  FROM "crew_payout_allocations" WHERE "payout_id" = target_payout_id;
  IF expected_amount IS DISTINCT FROM actual_amount THEN
    RAISE EXCEPTION 'payout allocation total must equal payout amount'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

-- Update notification metadata from the authoritative records once; clients do
-- not need a legacy points/currency interpretation path.
UPDATE notifications n
SET meta = (n.meta - 'pointsAmount' - 'ledgerCurrency') || jsonb_build_object(
  'amountMinor', e.amount_minor::text, 'currency', e.currency)
FROM crew_earning_entries e
WHERE n.type IN ('crew.earning.posted', 'crew.earning.rejected', 'crew.earning.reversed')
  AND n.meta->>'earningId' = e.id::text;

UPDATE notifications n
SET meta = (n.meta - 'pointsAmount' - 'ledgerCurrency') || jsonb_build_object(
  'amountMinor', p.amount_minor::text, 'currency', p.currency)
FROM crew_payouts p
WHERE n.type IN ('crew.payout.scheduled', 'crew.payout.paid', 'crew.payout.voided')
  AND n.meta->>'payoutId' = p.id::text;

COMMIT;
