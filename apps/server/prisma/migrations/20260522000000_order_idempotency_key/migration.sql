-- ServiceOrder: add idempotency key + per-buyer partial unique
--
-- Client mints a UUID per submit intent; sending it on retries
-- lets the server return the original order instead of creating a
-- duplicate. NULL key = legacy/pre-feature row (no dedup guarantee).
--
-- We can't express "UNIQUE WHERE idempotency_key IS NOT NULL" via
-- Prisma's @@unique, so the constraint is declared here as a raw
-- partial-unique index. Prisma schema declares the plain `@@index`
-- so migrate keeps generation idempotent.

ALTER TABLE "service_orders"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE INDEX IF NOT EXISTS "service_orders_buyer_idem_idx"
  ON "service_orders" ("buyer_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "service_orders_buyer_idem_unique"
  ON "service_orders" ("buyer_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
