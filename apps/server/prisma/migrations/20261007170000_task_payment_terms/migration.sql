ALTER TABLE crew_application_terms DROP CONSTRAINT crew_application_terms_payment_terms_check;
ALTER TABLE crew_application_terms ADD CONSTRAINT crew_application_terms_payment_terms_check CHECK(payment_terms IS NULL OR payment_terms IN ('monthly','half_upfront','on_completion','demo_promise'));
ALTER TABLE crew_positions DROP CONSTRAINT crew_positions_payment_terms_check;
ALTER TABLE crew_positions ADD CONSTRAINT crew_positions_payment_terms_check CHECK(payment_terms IS NULL OR payment_terms IN ('monthly','half_upfront','on_completion','demo_promise'));
