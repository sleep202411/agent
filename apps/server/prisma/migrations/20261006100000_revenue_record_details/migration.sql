ALTER TABLE crew_revenue_distributions
  ADD COLUMN income_date date,
  ADD COLUMN income_type varchar(32) CHECK (income_type IN ('licensing','advertising','merchandise','course_sales','other')),
  ADD COLUMN income_source varchar(180),
  ADD COLUMN notes varchar(200),
  ADD COLUMN contract_number varchar(180),
  ADD COLUMN signing_party varchar(180),
  ADD COLUMN contract_expires_on date;
CREATE TABLE crew_revenue_supporting_contracts (
  distribution_id uuid NOT NULL REFERENCES crew_revenue_distributions(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES crew_revenue_contracts(id) ON DELETE RESTRICT,
  PRIMARY KEY(distribution_id,contract_id)
);
CREATE FUNCTION guard_revenue_supporting_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Revenue supporting contracts are immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM crew_revenue_distributions d
    JOIN crew_revenue_contracts primary_file ON primary_file.id=d.contract_id
    JOIN crew_revenue_contracts supporting ON supporting.id=NEW.contract_id
    WHERE d.id=NEW.distribution_id AND supporting.crew_id=primary_file.crew_id AND supporting.id<>primary_file.id)
  THEN RAISE EXCEPTION 'Supporting contract must be a distinct file from the same Crew'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER revenue_supporting_contract_guard BEFORE INSERT OR UPDATE OR DELETE ON crew_revenue_supporting_contracts
  FOR EACH ROW EXECUTE FUNCTION guard_revenue_supporting_contract();
