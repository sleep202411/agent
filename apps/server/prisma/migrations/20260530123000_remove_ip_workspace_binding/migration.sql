-- Remove the direct workspace binding from the new IP commerce domain.
-- Current IP records are creator-owned content roots. Future links to
-- FizzStudio workspaces, projects, crews, or gigs must use explicit
-- integration/link tables instead of root-table ownership columns.

ALTER TABLE "ip_purchase_orders"
  DROP CONSTRAINT IF EXISTS "ip_purchase_orders_workspace_id_fkey";

ALTER TABLE "ips"
  DROP CONSTRAINT IF EXISTS "ips_workspace_id_fkey";

DROP INDEX IF EXISTS "ips_id_workspace_unique";
DROP INDEX IF EXISTS "ips_workspace_recent_idx";

CREATE INDEX IF NOT EXISTS "ips_creator_recent_idx"
  ON "ips" ("created_by_id", "status", "updated_at" DESC);

ALTER TABLE "ip_purchase_orders"
  DROP COLUMN IF EXISTS "workspace_id";

ALTER TABLE "ips"
  DROP COLUMN IF EXISTS "workspace_id";
