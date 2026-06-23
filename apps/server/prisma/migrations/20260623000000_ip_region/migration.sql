-- Add nullable region marker to IPs (ISO-3166 alpha-2, or 'GLOBAL'). Nullable, no backfill.
ALTER TABLE "ips" ADD COLUMN "region" VARCHAR(16);
