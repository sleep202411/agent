-- Keep previously accepted offers unspecified; never infer new payment timing.
ALTER TABLE crew_application_terms ADD COLUMN payment_terms varchar(32);
ALTER TABLE crew_application_terms ADD CONSTRAINT crew_application_terms_payment_terms_check
CHECK (payment_terms IS NULL OR payment_terms IN ('monthly', 'half_upfront', 'on_completion'));

ALTER TABLE crew_positions ADD COLUMN payment_terms varchar(32);
ALTER TABLE crew_positions ADD CONSTRAINT crew_positions_payment_terms_check
CHECK (payment_terms IS NULL OR payment_terms IN ('monthly', 'half_upfront', 'on_completion'));
