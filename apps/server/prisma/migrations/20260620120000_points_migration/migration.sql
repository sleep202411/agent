-- Per-user Java->PG points migration marker.
CREATE TABLE "points_migrations" (
  "id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "migrated_balance" INTEGER NOT NULL,
  "workspace_id" UUID NOT NULL,
  "migrated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "points_migrations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "points_migrations_user_id_key" ON "points_migrations"("user_id");
