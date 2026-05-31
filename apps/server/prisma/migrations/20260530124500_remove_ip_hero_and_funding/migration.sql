-- Remove IP fields/tables that do not have a closed product loop yet.
-- Hero visuals can be reintroduced later as an explicit asset placement
-- system. Investor / partnership pitch should return as a complete lead
-- collection and compliance-reviewed workflow, not a standalone table.

ALTER TABLE "ips"
  DROP CONSTRAINT IF EXISTS "ips_hero_asset_id_fkey";

ALTER TABLE "ips"
  DROP COLUMN IF EXISTS "hero_asset_id";

DROP TABLE IF EXISTS "ip_fundraising_campaigns" CASCADE;
DROP TYPE IF EXISTS "IpFundraisingStatus";
