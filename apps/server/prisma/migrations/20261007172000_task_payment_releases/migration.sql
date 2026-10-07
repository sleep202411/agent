CREATE TABLE task_payment_releases (
 id uuid PRIMARY KEY,task_id uuid NOT NULL REFERENCES crew_tasks(id) ON DELETE RESTRICT,
 user_id varchar(64) NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),currency varchar(3) NOT NULL CHECK(currency IN ('USD','CNY')),
 payment_terms varchar(32) NOT NULL CHECK(payment_terms IN ('half_upfront','on_completion')),
 receipt_reference varchar(180) NOT NULL CHECK(length(trim(receipt_reference))>0),
 milestone_evidence varchar(2000) NOT NULL CHECK(length(trim(milestone_evidence))>0),
 confirmed_by_admin_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(task_id,user_id)
);
CREATE TRIGGER task_payment_release_immutable BEFORE UPDATE OR DELETE ON task_payment_releases FOR EACH ROW EXECUTE FUNCTION academy_allocation_immutable();
