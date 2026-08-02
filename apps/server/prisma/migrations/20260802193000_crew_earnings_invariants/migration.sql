-- Financial history is append-only. Enforce the earning state machine and
-- immutable source fields below the application layer so maintenance scripts
-- and future code paths cannot rewrite or delete confirmed crew points.

BEGIN;

ALTER TABLE "crew_earning_entries"
  ADD CONSTRAINT "crew_earning_entries_source_shape_check" CHECK (
    (
      "source_type" = 'task_reward'
      AND "task_id" IS NOT NULL
      AND "agreement_id" IS NULL
      AND "status" IN ('posted', 'reversed')
    ) OR (
      "source_type" = 'contract_compensation'
      AND "task_id" IS NULL
      AND "agreement_id" IS NOT NULL
    ) OR (
      "source_type" NOT IN ('task_reward', 'contract_compensation')
      AND "task_id" IS NULL
      AND "agreement_id" IS NULL
    )
  );

CREATE FUNCTION guard_crew_earning_entry_update()
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
    NEW."points_amount",
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
    OLD."points_amount",
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

CREATE TRIGGER "crew_earning_entries_guard_update"
BEFORE UPDATE ON "crew_earning_entries"
FOR EACH ROW EXECUTE FUNCTION guard_crew_earning_entry_update();

CREATE FUNCTION reject_crew_earning_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'crew earning events are append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "crew_earning_events_reject_update"
BEFORE UPDATE ON "crew_earning_events"
FOR EACH ROW EXECUTE FUNCTION reject_crew_earning_event_mutation();

CREATE TRIGGER "crew_earning_events_reject_delete"
BEFORE DELETE ON "crew_earning_events"
FOR EACH ROW EXECUTE FUNCTION reject_crew_earning_event_mutation();

CREATE FUNCTION guard_crew_payout_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."id", NEW."crew_id", NEW."crew_member_id", NEW."user_id",
    NEW."points_amount", NEW."withholding_amount_minor",
    NEW."net_amount_minor", NEW."note", NEW."idempotency_key",
    NEW."created_by_user_id", NEW."created_at"
  ) IS DISTINCT FROM (
    OLD."id", OLD."crew_id", OLD."crew_member_id", OLD."user_id",
    OLD."points_amount", OLD."withholding_amount_minor",
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

CREATE TRIGGER "crew_payouts_guard_update"
BEFORE UPDATE ON "crew_payouts"
FOR EACH ROW EXECUTE FUNCTION guard_crew_payout_update();

CREATE FUNCTION guard_crew_payout_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  earning_points BIGINT;
  earning_crew TEXT;
  earning_user VARCHAR(64);
  payout_crew TEXT;
  payout_user VARCHAR(64);
  allocated_points BIGINT;
BEGIN
  SELECT "points_amount", "crew_id", "user_id"
    INTO earning_points, earning_crew, earning_user
  FROM "crew_earning_entries"
  WHERE "id" = NEW."earning_id" AND "status" = 'posted'
  FOR UPDATE;

  IF earning_points IS NULL THEN
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

  SELECT COALESCE(SUM(allocation."points_amount"), 0)
    INTO allocated_points
  FROM "crew_payout_allocations" allocation
  JOIN "crew_payouts" payout ON payout."id" = allocation."payout_id"
  WHERE allocation."earning_id" = NEW."earning_id"
    AND payout."status" IN ('pending', 'paid');

  IF allocated_points + NEW."points_amount" > earning_points THEN
    RAISE EXCEPTION 'payout allocations exceed earning points'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "crew_payout_allocations_guard_insert"
BEFORE INSERT ON "crew_payout_allocations"
FOR EACH ROW EXECUTE FUNCTION guard_crew_payout_allocation();

CREATE FUNCTION reject_crew_payout_allocation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'crew payout allocations are immutable'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "crew_payout_allocations_reject_update"
BEFORE UPDATE ON "crew_payout_allocations"
FOR EACH ROW EXECUTE FUNCTION reject_crew_payout_allocation_mutation();
CREATE TRIGGER "crew_payout_allocations_reject_delete"
BEFORE DELETE ON "crew_payout_allocations"
FOR EACH ROW EXECUTE FUNCTION reject_crew_payout_allocation_mutation();

CREATE FUNCTION validate_crew_payout_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_payout_id UUID;
  expected_points BIGINT;
  actual_points BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'crew_payouts' THEN
    target_payout_id := NEW."id";
  ELSE
    target_payout_id := NEW."payout_id";
  END IF;
  SELECT "points_amount" INTO expected_points FROM "crew_payouts" WHERE "id" = target_payout_id;
  SELECT COALESCE(SUM("points_amount"), 0) INTO actual_points
  FROM "crew_payout_allocations" WHERE "payout_id" = target_payout_id;
  IF expected_points IS DISTINCT FROM actual_points THEN
    RAISE EXCEPTION 'payout allocation total must equal payout points'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "crew_payout_allocations_total_check"
AFTER INSERT ON "crew_payout_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_crew_payout_allocation_total();

CREATE CONSTRAINT TRIGGER "crew_payouts_total_check"
AFTER INSERT ON "crew_payouts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_crew_payout_allocation_total();

CREATE TRIGGER "crew_payout_events_reject_update"
BEFORE UPDATE ON "crew_payout_events"
FOR EACH ROW EXECUTE FUNCTION reject_crew_earning_event_mutation();
CREATE TRIGGER "crew_payout_events_reject_delete"
BEFORE DELETE ON "crew_payout_events"
FOR EACH ROW EXECUTE FUNCTION reject_crew_earning_event_mutation();

COMMIT;
