-- AlterTable
ALTER TABLE "ai_actors" ADD COLUMN "category" VARCHAR(32) NOT NULL DEFAULT 'ai_actor';

-- CreateIndex
CREATE INDEX "ai_actors_category_archived_at_active_created_at_id_idx" ON "ai_actors"("category", "archived_at", "active", "created_at", "id");
