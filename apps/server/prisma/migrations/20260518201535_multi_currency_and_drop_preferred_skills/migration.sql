/*
  Warnings:

  - You are about to drop the column `preferred_skills` on the `crew_positions` table. All the data in the column will be lost.
  - You are about to drop the column `salary_max_cents` on the `crew_positions` table. All the data in the column will be lost.
  - You are about to drop the column `salary_min_cents` on the `crew_positions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "crew_positions" DROP COLUMN "preferred_skills",
DROP COLUMN "salary_max_cents",
DROP COLUMN "salary_min_cents",
ADD COLUMN     "salary_currency" VARCHAR(3),
ADD COLUMN     "salary_max_amount" BIGINT,
ADD COLUMN     "salary_min_amount" BIGINT;

-- ─────────────────────────────────────────────────────────────
-- Multi-currency hardening: replace the CNY-only revenue CHECK
-- with a global ISO 4217 whitelist; add the same whitelist to the
-- new salary_currency column. Cell-specific narrowing (cn → CNY
-- only) is enforced at the service layer, not here, so the same
-- migration deploys cleanly on every cell.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "episode_assignments"
  DROP CONSTRAINT IF EXISTS "chk_episode_assignments_revenue_currency_cny";

ALTER TABLE "episode_assignments"
  ADD CONSTRAINT "chk_episode_assignments_revenue_currency"
  CHECK (
    "revenue_currency" IS NULL
    OR "revenue_currency" IN
      ('CNY','USD','EUR','GBP','JPY','HKD','AUD','CAD','SGD')
  );

ALTER TABLE "crew_positions"
  ADD CONSTRAINT "chk_crew_positions_salary_currency"
  CHECK (
    "salary_currency" IS NULL
    OR "salary_currency" IN
      ('CNY','USD','EUR','GBP','JPY','HKD','AUD','CAD','SGD')
  );

-- Salary amount checks — same shape as before but on the renamed
-- columns. (Original chk_crew_positions_salary_min_nonneg etc.
-- referenced salary_min_cents which we just dropped, so they
-- already vanished above when Prisma dropped the columns.)
ALTER TABLE "crew_positions"
  ADD CONSTRAINT "chk_crew_positions_salary_min_nonneg"
    CHECK ("salary_min_amount" IS NULL OR "salary_min_amount" >= 0),
  ADD CONSTRAINT "chk_crew_positions_salary_max_nonneg"
    CHECK ("salary_max_amount" IS NULL OR "salary_max_amount" >= 0),
  ADD CONSTRAINT "chk_crew_positions_salary_range"
    CHECK (
      "salary_min_amount" IS NULL
      OR "salary_max_amount" IS NULL
      OR "salary_max_amount" >= "salary_min_amount"
    );

-- A position carrying salary amounts MUST also have a currency.
ALTER TABLE "crew_positions"
  ADD CONSTRAINT "chk_crew_positions_salary_needs_currency"
  CHECK (
    ("salary_min_amount" IS NULL AND "salary_max_amount" IS NULL)
    OR "salary_currency" IS NOT NULL
  );
