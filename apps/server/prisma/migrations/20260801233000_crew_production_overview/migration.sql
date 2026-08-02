CREATE TYPE "CrewEpisodeStatus" AS ENUM (
  'planned',
  'in_production',
  'in_review',
  'completed',
  'cancelled'
);

CREATE TYPE "CrewEpisodeDeliveryStatus" AS ENUM (
  'submitted',
  'approved',
  'rejected'
);

CREATE TABLE "crew_production_pages" (
  "crew_id" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "updated_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_production_pages_pkey" PRIMARY KEY ("crew_id"),
  CONSTRAINT "crew_production_pages_document_object" CHECK (
    jsonb_typeof("document") = 'object' AND "document"->>'type' = 'doc'
  ),
  CONSTRAINT "crew_production_pages_version_positive" CHECK ("version" > 0),
  CONSTRAINT "crew_production_pages_crew_id_fkey"
    FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "crew_production_pages" (
  "crew_id",
  "document",
  "version",
  "created_by_user_id",
  "updated_by_user_id"
)
SELECT
  crew."id",
  jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(
      jsonb_build_object(
        'type', 'paragraph',
        'attrs', jsonb_build_object('id', gen_random_uuid()::text)
      )
    )
  ),
  1,
  crew."created_by_user_id",
  crew."created_by_user_id"
FROM "crews" crew;

CREATE TABLE "crew_episodes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "crew_id" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "synopsis" TEXT NOT NULL DEFAULT '',
  "status" "CrewEpisodeStatus" NOT NULL DEFAULT 'planned',
  "duration_seconds" INTEGER,
  "planned_release_at" TIMESTAMPTZ(6),
  "rank" DECIMAL(36,18) NOT NULL DEFAULT 1024,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_episodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_episodes_number_positive" CHECK ("number" > 0),
  CONSTRAINT "crew_episodes_title_nonempty" CHECK (btrim("title") <> ''),
  CONSTRAINT "crew_episodes_duration_positive" CHECK ("duration_seconds" IS NULL OR "duration_seconds" > 0),
  CONSTRAINT "crew_episodes_version_positive" CHECK ("version" > 0),
  CONSTRAINT "crew_episodes_crew_id_fkey"
    FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "crew_episodes_id_crew_unique"
  ON "crew_episodes"("id", "crew_id");
CREATE UNIQUE INDEX "crew_episodes_crew_number_unique"
  ON "crew_episodes"("crew_id", "number");
CREATE INDEX "crew_episodes_crew_rank_idx"
  ON "crew_episodes"("crew_id", "rank", "id");
CREATE INDEX "crew_episodes_crew_status_idx"
  ON "crew_episodes"("crew_id", "status", "updated_at" DESC);

ALTER TABLE "crew_tasks" ADD COLUMN "episode_id" UUID;
ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_episode_id_crew_id_fkey"
  FOREIGN KEY ("episode_id", "crew_id")
  REFERENCES "crew_episodes"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "crew_tasks_crew_episode_rank_idx"
  ON "crew_tasks"("crew_id", "episode_id", "rank", "id");

CREATE TABLE "crew_episode_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "crew_id" TEXT NOT NULL,
  "episode_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "asset_node_id" UUID NOT NULL,
  "status" "CrewEpisodeDeliveryStatus" NOT NULL DEFAULT 'submitted',
  "note" TEXT NOT NULL DEFAULT '',
  "review_note" TEXT NOT NULL DEFAULT '',
  "submitted_by_user_id" VARCHAR(64) NOT NULL,
  "reviewed_by_user_id" VARCHAR(64),
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_episode_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_episode_deliveries_version_positive" CHECK ("version_number" > 0),
  CONSTRAINT "crew_episode_deliveries_review_state" CHECK (
    ("status" = 'submitted' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL) OR
    ("status" IN ('approved', 'rejected') AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  ),
  CONSTRAINT "crew_episode_deliveries_episode_id_crew_id_fkey"
    FOREIGN KEY ("episode_id", "crew_id")
    REFERENCES "crew_episodes"("id", "crew_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crew_episode_deliveries_asset_node_id_crew_id_fkey"
    FOREIGN KEY ("asset_node_id", "crew_id")
    REFERENCES "crew_asset_nodes"("id", "crew_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "crew_episode_deliveries_episode_version_unique"
  ON "crew_episode_deliveries"("episode_id", "version_number");
CREATE INDEX "crew_episode_deliveries_crew_status_idx"
  ON "crew_episode_deliveries"("crew_id", "status", "created_at" DESC);
CREATE INDEX "crew_episode_deliveries_asset_idx"
  ON "crew_episode_deliveries"("asset_node_id");
