-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('remote', 'hybrid', 'onsite');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('full_time', 'part_time', 'contract', 'freelance', 'project_based');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('any', 'junior', 'mid', 'senior', 'lead');

-- AlterTable
ALTER TABLE "crew_applications" ADD COLUMN     "available_start_date" DATE,
ADD COLUMN     "expected_salary_cents" BIGINT,
ADD COLUMN     "portfolio_url" TEXT,
ADD COLUMN     "years_experience" INTEGER;

-- AlterTable
ALTER TABLE "crew_positions" ADD COLUMN     "close_date" DATE,
ADD COLUMN     "employment_type" "EmploymentType" NOT NULL DEFAULT 'project_based',
ADD COLUMN     "experience_level" "ExperienceLevel" NOT NULL DEFAULT 'any',
ADD COLUMN     "location" VARCHAR(128),
ADD COLUMN     "preferred_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "required_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "salary_max_cents" BIGINT,
ADD COLUMN     "salary_min_cents" BIGINT,
ADD COLUMN     "salary_negotiable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salary_period" VARCHAR(16),
ADD COLUMN     "work_mode" "WorkMode" NOT NULL DEFAULT 'remote';

-- CreateIndex
CREATE INDEX "crew_positions_work_mode_idx" ON "crew_positions"("work_mode", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "crew_positions_close_date_idx" ON "crew_positions"("close_date", "status");

-- ─────────────────────────────────────────────────────────────
-- Recruitment hardening — CHECK constraints (Prisma DSL can't
-- express conditional cross-column checks like
-- "max >= min when both set").
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "crew_positions"
  ADD CONSTRAINT "chk_crew_positions_salary_min_nonneg"
    CHECK ("salary_min_cents" IS NULL OR "salary_min_cents" >= 0),
  ADD CONSTRAINT "chk_crew_positions_salary_max_nonneg"
    CHECK ("salary_max_cents" IS NULL OR "salary_max_cents" >= 0),
  ADD CONSTRAINT "chk_crew_positions_salary_range"
    CHECK (
      "salary_min_cents" IS NULL
      OR "salary_max_cents" IS NULL
      OR "salary_max_cents" >= "salary_min_cents"
    ),
  -- Location must be supplied when work mode is not 'remote'.
  ADD CONSTRAINT "chk_crew_positions_onsite_needs_location"
    CHECK (
      "work_mode" = 'remote'
      OR ("location" IS NOT NULL AND length("location") > 0)
    );

ALTER TABLE "crew_applications"
  ADD CONSTRAINT "chk_crew_applications_expected_salary_nonneg"
    CHECK ("expected_salary_cents" IS NULL OR "expected_salary_cents" >= 0),
  ADD CONSTRAINT "chk_crew_applications_years_experience_nonneg"
    CHECK ("years_experience" IS NULL OR "years_experience" >= 0);
