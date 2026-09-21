CREATE TABLE "ai_actors" (
 "id" UUID NOT NULL PRIMARY KEY,
 "name" VARCHAR(64) NOT NULL,
 "photo_asset_id" UUID NOT NULL REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "active" BOOLEAN NOT NULL DEFAULT false,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "ai_actors_active_created_at_id_idx" ON "ai_actors"("active", "created_at", "id");
CREATE TABLE "ai_actor_unlocks" (
 "actor_id" UUID NOT NULL REFERENCES "ai_actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "user_id" VARCHAR(64) NOT NULL,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("actor_id", "workspace_id")
);
CREATE TABLE "ai_actor_uses" (
 "id" UUID NOT NULL PRIMARY KEY,
 "actor_id" UUID NOT NULL REFERENCES "ai_actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "project_id" UUID NOT NULL,
 "user_id" VARCHAR(64) NOT NULL,
 "photo_asset_id" UUID NOT NULL,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("project_id", "workspace_id") REFERENCES "platform_projects"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ai_actor_uses_actor_id_created_at_id_idx" ON "ai_actor_uses"("actor_id", "created_at", "id");
