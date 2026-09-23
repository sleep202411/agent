-- Only future inserts change. Existing classifications are preserved.
ALTER TABLE "ips" ALTER COLUMN "channel_type" SET DEFAULT 'ip';
