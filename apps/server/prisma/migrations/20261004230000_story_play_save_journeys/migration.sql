ALTER TABLE "story_play_saves" ADD COLUMN "journey" JSONB;

CREATE TABLE "story_play_save_anchors" (
    "user_id" VARCHAR(64) NOT NULL,
    "game_id" VARCHAR(128) NOT NULL,
    "chapter_id" VARCHAR(128) NOT NULL,
    "scene_id" VARCHAR(160) NOT NULL,
    "anchor" JSONB NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    CONSTRAINT "story_play_save_anchors_pkey" PRIMARY KEY ("user_id", "game_id", "chapter_id", "scene_id"),
    CONSTRAINT "story_play_save_anchors_save_fkey" FOREIGN KEY ("user_id", "game_id", "chapter_id") REFERENCES "story_play_saves"("user_id", "game_id", "chapter_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_play_save_anchors_size_check" CHECK ("size_bytes" >= 0)
);
