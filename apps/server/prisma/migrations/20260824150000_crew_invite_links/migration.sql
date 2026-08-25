-- Shareable crew invite links.
--
-- CrewInvitation stays what it is: one row per named invitee, accepted from
-- that person's inbox. This is the other shape — a bearer link anyone can
-- follow into the crew, at access fixed when the link was minted.
--
-- Only sha256(token) is stored; the raw token exists once, in the URL the
-- creator copies. Redemptions are rows rather than a counter alone so a
-- double-click cannot burn two uses.

CREATE TABLE "crew_invite_links" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "policy_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "max_uses" INTEGER,
  "use_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_by_user_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crew_invite_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_invite_links_token_hash_chk"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "crew_invite_links_actor_chk"
    CHECK (btrim("created_by_user_id") <> ''),
  -- A zero/negative cap would be a link that can never be used; unlimited is
  -- expressed by NULL, never by 0.
  CONSTRAINT "crew_invite_links_max_uses_chk"
    CHECK ("max_uses" IS NULL OR "max_uses" > 0),
  CONSTRAINT "crew_invite_links_use_count_chk"
    CHECK ("use_count" >= 0)
);

CREATE UNIQUE INDEX "crew_invite_links_token_hash_unique"
  ON "crew_invite_links" ("token_hash");
CREATE INDEX "crew_invite_links_crew_created_idx"
  ON "crew_invite_links" ("crew_id", "created_at" DESC);

ALTER TABLE "crew_invite_links"
  ADD CONSTRAINT "crew_invite_links_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew_invite_link_redemptions" (
  "id" UUID NOT NULL,
  "link_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "member_id" TEXT,
  "redeemed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crew_invite_link_redemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_invite_link_redemptions_user_chk"
    CHECK (btrim("user_id") <> '')
);

CREATE UNIQUE INDEX "crew_invite_link_redemptions_link_user_unique"
  ON "crew_invite_link_redemptions" ("link_id", "user_id");

ALTER TABLE "crew_invite_link_redemptions"
  ADD CONSTRAINT "crew_invite_link_redemptions_link_id_fkey"
  FOREIGN KEY ("link_id") REFERENCES "crew_invite_links" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
