-- AlterTable
ALTER TABLE "ai_actors" ADD COLUMN "archived_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "ai_actors_active_archived_at_created_at_id_idx" ON "ai_actors"("active", "archived_at", "created_at", "id");
