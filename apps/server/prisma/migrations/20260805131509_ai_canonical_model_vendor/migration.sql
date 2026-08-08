-- AlterTable
ALTER TABLE "ai_canonical_models" ADD COLUMN IF NOT EXISTS "vendor" VARCHAR(64);
