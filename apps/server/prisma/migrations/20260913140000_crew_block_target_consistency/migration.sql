-- Crew was added to the enum without extending the existing consistency check.
-- Preserve the IP/creator rules and allow Crew targets without an IP foreign key.
BEGIN;
ALTER TABLE "ip_user_content_blocks"
  DROP CONSTRAINT "ip_user_content_blocks_target_consistency";
ALTER TABLE "ip_user_content_blocks"
  ADD CONSTRAINT "ip_user_content_blocks_target_consistency"
  CHECK (
    ("target_type" = 'ip' AND ("ip_id" IS NULL OR "target_id" = "ip_id"::text))
    OR ("target_type" IN ('creator', 'crew') AND "ip_id" IS NULL)
  );
COMMIT;
