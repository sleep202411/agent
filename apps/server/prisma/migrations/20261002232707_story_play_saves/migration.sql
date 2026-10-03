-- Interactive-film play saves: one current-run slot per user/game/chapter.
-- Written by hand instead of `migrate dev` because the repo carries a
-- pre-existing drift (20260724203000 creates studio_agent_orphan_discovery_cursor
-- whose model was later removed from the schema) — a generated diff would have
-- bundled that unrelated DROP into this migration. This file only creates the
-- new table; the orphan-table drift is left for its owning module to resolve.
CREATE TABLE "story_play_saves" (
 "user_id" VARCHAR(64) NOT NULL,
 "game_id" VARCHAR(128) NOT NULL,
 "chapter_id" VARCHAR(128) NOT NULL,
 "content_version" VARCHAR(128) NOT NULL,
 "state" JSONB NOT NULL,
 "events" JSONB NOT NULL,
 "updated_at" TIMESTAMPTZ(6) NOT NULL,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("user_id", "game_id", "chapter_id")
);
CREATE INDEX "story_play_saves_latest_idx" ON "story_play_saves"("user_id", "game_id", "updated_at" DESC);
