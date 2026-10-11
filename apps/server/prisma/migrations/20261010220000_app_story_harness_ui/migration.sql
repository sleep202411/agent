ALTER TABLE "app_story_runs" ADD COLUMN "harness_events" JSONB, ADD COLUMN "attachments" JSONB, ADD COLUMN "media_quote" JSONB;
CREATE TABLE "app_story_conversations" (
 "chapter_id" UUID NOT NULL, "actor_id" VARCHAR(64) NOT NULL, "project_id" UUID NOT NULL,
 "title" VARCHAR(160) NOT NULL, "pinned" BOOLEAN NOT NULL DEFAULT false,
 "archived" BOOLEAN NOT NULL DEFAULT false, "rank" INTEGER NOT NULL DEFAULT 0,
 "inherited" JSONB NOT NULL DEFAULT '[]', "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("chapter_id","actor_id"),
 CONSTRAINT "app_story_conversations_chapter_scope_fkey" FOREIGN KEY ("chapter_id", "project_id") REFERENCES "story_chapters"("id", "story_project_id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "app_story_conversations_project_id_actor_id_rank_idx" ON "app_story_conversations"("project_id","actor_id","rank");
CREATE TABLE "app_story_attachments" (
 "id" UUID NOT NULL PRIMARY KEY, "project_id" UUID NOT NULL, "chapter_id" UUID NOT NULL,
 "actor_id" VARCHAR(64) NOT NULL, "name" VARCHAR(255) NOT NULL, "media_type" VARCHAR(160) NOT NULL,
 "hash" VARCHAR(64) NOT NULL, "bytes" INTEGER NOT NULL, "width" INTEGER, "height" INTEGER,
 "data" BYTEA NOT NULL, "document_id" UUID, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "app_story_attachments_chapter_scope_fkey" FOREIGN KEY ("chapter_id", "project_id") REFERENCES "story_chapters"("id", "story_project_id") ON DELETE CASCADE ON UPDATE NO ACTION,
 FOREIGN KEY ("document_id") REFERENCES "copilot_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "app_story_attachments_project_id_actor_id_chapter_id_idx" ON "app_story_attachments"("project_id","actor_id","chapter_id");
CREATE INDEX "app_story_attachments_project_id_actor_id_chapter_id_hash_idx" ON "app_story_attachments"("project_id","actor_id","chapter_id","hash");
