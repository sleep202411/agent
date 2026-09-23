-- Product correction: move all existing, non-deleted titles to IP Channel.
-- Runs once per database through Prisma migrations. New titles retain the
-- existing creator choice and community default after this migration.
-- Bump versions so an already-open Admin editor cannot overwrite this change.
UPDATE "ips"
SET "channel_type" = 'ip'::"IpChannelType",
    "version" = "version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "channel_type" = 'community'::"IpChannelType"
  AND "deleted_at" IS NULL;
