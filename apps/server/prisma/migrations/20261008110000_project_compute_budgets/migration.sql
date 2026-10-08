CREATE TABLE crew_project_compute_budgets (
 crew_id text PRIMARY KEY REFERENCES crews(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
ALTER TABLE task_payment_releases ADD COLUMN deduction_minor bigint NOT NULL DEFAULT 0 CHECK(deduction_minor >= 0);
ALTER TABLE task_payment_releases DROP CONSTRAINT task_payment_releases_amount_minor_check;
ALTER TABLE task_payment_releases ADD CONSTRAINT task_payment_release_net_check CHECK(amount_minor >= 0 AND amount_minor + deduction_minor > 0);
-- A configured project cannot evade its budget by switching to a fresh wallet.
CREATE FUNCTION crew_project_compute_workspace_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id AND EXISTS(SELECT 1 FROM crew_project_compute_budgets WHERE crew_id=OLD.id) THEN
  RAISE EXCEPTION 'Project compute budget pins the Crew workspace';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER crew_project_compute_workspace_guard BEFORE UPDATE OF workspace_id ON crews FOR EACH ROW EXECUTE FUNCTION crew_project_compute_workspace_guard();
