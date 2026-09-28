CREATE TYPE "IpChannelType" AS ENUM ('ip', 'community');
ALTER TABLE "ips" ADD COLUMN "channel_type" "IpChannelType" NOT NULL DEFAULT 'community';
CREATE INDEX "ips_channel_public_idx" ON "ips" ("channel_type", "status", "listing_visibility");
