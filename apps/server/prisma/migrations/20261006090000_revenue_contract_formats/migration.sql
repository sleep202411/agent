ALTER TABLE crew_revenue_contracts ADD COLUMN content_type varchar(32) NOT NULL DEFAULT 'application/pdf';
ALTER TABLE crew_revenue_contracts ADD CONSTRAINT crew_revenue_contract_type_check CHECK (content_type IN ('application/pdf','image/jpeg','image/png'));
