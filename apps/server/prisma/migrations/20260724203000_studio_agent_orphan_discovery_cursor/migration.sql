-- Orphan discovery re-adjudicated every Studio Agent upload on every sweep:
-- `created_at <= cutoff` is an open-ended bound, the discriminators were a
-- leading-wildcard LIKE plus an unindexed jsonb expression, and nothing marked
-- an asset as already examined. This supplies the missing index and the
-- watermark that bounds the range on both sides.

CREATE TABLE "studio_agent_orphan_discovery_cursor" (
  "id" VARCHAR(32) NOT NULL,
  "scanned_through_created_at" TIMESTAMPTZ(6) NOT NULL,
  "scanned_through_asset_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_agent_orphan_discovery_cursor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_orphan_discovery_cursor_singleton"
    CHECK ("id" = 'singleton')
);

-- Seeded below every possible row, so the watermark can only ever move forward
-- over a range that was actually adjudicated. There is nothing to walk today:
-- both upload kinds are introduced by this same unreleased changeset, so the
-- first sweep is one empty index descent that jumps the cursor to the cutoff.
INSERT INTO "studio_agent_orphan_discovery_cursor" (
  "id",
  "scanned_through_created_at",
  "scanned_through_asset_id"
)
VALUES (
  'singleton',
  '-infinity'::TIMESTAMPTZ,
  '00000000-0000-0000-0000-000000000000'::UUID
);

-- The candidate set for discovery, in scan order. `metadata->>'uploadKind'` is
-- the real discriminator: media-upload writes it on every confirmed asset and
-- derives the object-key segment from the same policy entry, so the old
-- `object_key LIKE '%/…/%'` pair carried no extra information and could not be
-- indexed at all. The kinds must remain SQL literals here AND in the query:
-- predicate_implied_by() proves the implication only from identical Const
-- nodes, and a bind parameter silently reverts to a full range scan.
CREATE INDEX "media_assets_studio_agent_orphan_discovery_idx"
ON "media_assets" ("created_at", "id")
WHERE "metadata"->>'uploadKind' IN ('studio_agent_image', 'studio_agent_document')
  AND "deleted_at" IS NULL
  AND "status" = 'ready'
  AND "source" = 'user_upload';
