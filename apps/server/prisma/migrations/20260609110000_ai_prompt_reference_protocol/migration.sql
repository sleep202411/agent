ALTER TABLE "ai_jobs"
  ADD COLUMN "prompt_document" JSONB,
  ADD COLUMN "prompt_display_text" TEXT,
  ADD COLUMN "prompt_search_text" TEXT,
  ADD COLUMN "compiled_prompt" TEXT,
  ADD COLUMN "reference_snapshot" JSONB,
  ADD COLUMN "style_snapshot" JSONB;
