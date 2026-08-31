CREATE TABLE "agent_os_model_preferences" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "project_kind" VARCHAR(32) NOT NULL,
    "actor_id" VARCHAR(64) NOT NULL,
    "chat_model_profile_id" VARCHAR(64),
    "image_model_id" VARCHAR(180),
    "video_model_id" VARCHAR(180),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_os_model_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_os_model_preferences_project_actor_unique"
    ON "agent_os_model_preferences"("project_id", "actor_id");

CREATE INDEX "agent_os_model_preferences_actor_recent_idx"
    ON "agent_os_model_preferences"("actor_id", "updated_at" DESC);
