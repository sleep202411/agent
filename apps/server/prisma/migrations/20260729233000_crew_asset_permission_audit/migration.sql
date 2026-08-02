CREATE TABLE "crew_asset_permission_events" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "node_id" UUID NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "previous_mode" "CrewAssetAccessMode" NOT NULL,
  "next_mode" "CrewAssetAccessMode" NOT NULL,
  "previous_version" INTEGER NOT NULL,
  "next_version" INTEGER NOT NULL,
  "previous_grants" JSONB NOT NULL,
  "next_grants" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crew_asset_permission_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crew_asset_permission_events_node_idx"
  ON "crew_asset_permission_events"("crew_id", "node_id", "created_at" DESC);
CREATE INDEX "crew_asset_permission_events_actor_idx"
  ON "crew_asset_permission_events"("crew_id", "actor_user_id", "created_at" DESC);
