ALTER TABLE "crew_pdf_task_imports" ADD COLUMN "source_text" TEXT;
CREATE TABLE "_GroupedRecruitment" (
  "A" TEXT NOT NULL REFERENCES "crew_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "B" UUID NOT NULL REFERENCES "crew_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_GroupedRecruitment_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_GroupedRecruitment_B_index" ON "_GroupedRecruitment"("B");

ALTER TABLE "crew_positions" ADD COLUMN "grouped_task_terms" JSONB;
