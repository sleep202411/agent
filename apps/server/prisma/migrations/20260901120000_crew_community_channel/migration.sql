-- A crew now owns two fixed conversation channels: the existing private team
-- room and a separate community room. Existing rows are backfilled as team rooms.
CREATE TYPE "crew_conversation_channel" AS ENUM ('team', 'community');

ALTER TABLE "conversations"
  ADD COLUMN "crew_channel" "crew_conversation_channel";

UPDATE "conversations"
SET "crew_channel" = 'team'
WHERE "context_type" = 'crew';

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_crew_channel_check"
  CHECK (
    ("context_type" = 'crew' AND "crew_channel" IS NOT NULL)
    OR
    ("context_type" <> 'crew' AND "crew_channel" IS NULL)
  );

-- Reuse the hardened bearer-link lifecycle while keeping member and community
-- redemption semantics separate.
CREATE TYPE "crew_invite_link_kind" AS ENUM ('member', 'community');

ALTER TABLE "crew_invite_links"
  ADD COLUMN "kind" "crew_invite_link_kind" NOT NULL DEFAULT 'member';

DROP INDEX "crew_invite_links_crew_created_idx";

CREATE INDEX "crew_invite_links_crew_kind_created_idx"
  ON "crew_invite_links" ("crew_id", "kind", "created_at" DESC);
