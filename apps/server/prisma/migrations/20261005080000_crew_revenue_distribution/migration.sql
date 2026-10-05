CREATE TABLE crew_revenue_contracts (
 id uuid PRIMARY KEY,
 crew_id text NOT NULL REFERENCES crews(id) ON DELETE RESTRICT,
 filename varchar(255) NOT NULL,
 storage_provider "MediaStorageProvider" NOT NULL,
 bucket varchar(255) NOT NULL, region varchar(128), object_key varchar(1024) NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes>0),
 checksum_sha256 varchar(64) NOT NULL CHECK(checksum_sha256 ~ '^[0-9a-f]{64}$'),
 uploaded_by_admin_id uuid NOT NULL,
 verified_at timestamptz(6) NOT NULL,
 created_at timestamptz(6) NOT NULL DEFAULT now(),
 CONSTRAINT crew_revenue_contract_file_unique UNIQUE(crew_id,checksum_sha256)
);
CREATE TABLE crew_revenue_distributions (
 id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
 contract_id uuid NOT NULL REFERENCES crew_revenue_contracts(id) ON DELETE RESTRICT,
 revenue_reference varchar(180) NOT NULL CHECK(btrim(revenue_reference)<>''),
 title varchar(180) NOT NULL CHECK(btrim(title)<>''),
 currency varchar(3) NOT NULL CHECK(currency IN ('USD','CNY')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 request_hash varchar(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 allocations jsonb NOT NULL CHECK(jsonb_typeof(allocations)='array'),
 posted_by_admin_id uuid NOT NULL, posted_at timestamptz(6) NOT NULL DEFAULT now(),
 CONSTRAINT crew_revenue_reference_unique UNIQUE(contract_id,revenue_reference)
);
ALTER TABLE crew_earning_entries ADD COLUMN revenue_distribution_id uuid
 REFERENCES crew_revenue_distributions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX crew_revenue_beneficiary_unique
 ON crew_earning_entries(revenue_distribution_id,user_id);

CREATE FUNCTION protect_crew_revenue_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'Posted revenue and contract evidence are immutable'
   USING ERRCODE='integrity_constraint_violation';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER crew_revenue_contract_immutable BEFORE UPDATE ON crew_revenue_contracts
 FOR EACH ROW EXECUTE FUNCTION protect_crew_revenue_receipt();
CREATE TRIGGER crew_revenue_distribution_immutable BEFORE UPDATE ON crew_revenue_distributions
 FOR EACH ROW EXECUTE FUNCTION protect_crew_revenue_receipt();

CREATE FUNCTION validate_crew_revenue_distribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 target uuid;
 parent crew_revenue_distributions%ROWTYPE;
 contract_crew text;
BEGIN
 IF TG_TABLE_NAME='crew_revenue_distributions' THEN target:=NEW.id;
 ELSE
  IF TG_OP='UPDATE' AND NEW.revenue_distribution_id IS DISTINCT FROM OLD.revenue_distribution_id THEN
   RAISE EXCEPTION 'Revenue allocation binding is immutable';
  END IF;
  IF TG_OP='DELETE' THEN target:=OLD.revenue_distribution_id;
  ELSE target:=NEW.revenue_distribution_id; END IF;
 END IF;
 IF target IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO parent FROM crew_revenue_distributions WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT crew_id INTO contract_crew FROM crew_revenue_contracts WHERE id=parent.contract_id;
 IF (SELECT COALESCE(SUM(amount_minor),0) FROM crew_earning_entries WHERE revenue_distribution_id=target)<>parent.amount_minor
 OR EXISTS(SELECT 1 FROM crew_earning_entries WHERE revenue_distribution_id=target AND
   (crew_id<>contract_crew OR currency<>parent.currency OR source_type<>'revenue_share'
    OR status NOT IN ('posted','reversed')))
 OR (SELECT COALESCE(SUM((p->>'shareBps')::integer),0) FROM jsonb_array_elements(parent.allocations) p)<>10000
 OR (SELECT COALESCE(SUM((p->>'amountMinor')::numeric),0) FROM jsonb_array_elements(parent.allocations) p)<>parent.amount_minor
 OR EXISTS(
  SELECT 1 FROM
   (SELECT p->>'crewMemberId' member_id, p->>'userId' user_id, (p->>'amountMinor')::bigint amount
    FROM jsonb_array_elements(parent.allocations) p WHERE (p->>'amountMinor')::bigint>0) a
  FULL JOIN (SELECT crew_member_id, user_id, amount_minor FROM crew_earning_entries WHERE revenue_distribution_id=target) e
  ON a.member_id=e.crew_member_id AND a.user_id=e.user_id
  WHERE a.member_id IS NULL OR e.crew_member_id IS NULL OR a.amount<>e.amount_minor
 )
 THEN RAISE EXCEPTION 'Revenue allocation must match the contract Crew, currency, source and total'
   USING ERRCODE='integrity_constraint_violation'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER crew_revenue_total_consistent AFTER INSERT OR UPDATE ON crew_revenue_distributions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_crew_revenue_distribution();
CREATE CONSTRAINT TRIGGER crew_earning_revenue_consistent AFTER INSERT OR UPDATE OR DELETE ON crew_earning_entries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_crew_revenue_distribution();
