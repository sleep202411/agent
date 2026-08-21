-- Widen wallet columns so the Java bridge contract (idempotencyKey ≤180,
-- reason ≤500) fits after server-side prefixing. Pure varchar widening:
-- metadata-only in Postgres, no table rewrite.
ALTER TABLE "wallet_transactions" ALTER COLUMN "source_id" SET DATA TYPE VARCHAR(200);
ALTER TABLE "wallet_transactions" ALTER COLUMN "idempotency_key" SET DATA TYPE VARCHAR(240);
ALTER TABLE "wallet_transactions" ALTER COLUMN "description" SET DATA TYPE VARCHAR(500);
ALTER TABLE "wallet_credit_grants" ALTER COLUMN "source_id" SET DATA TYPE VARCHAR(200);
