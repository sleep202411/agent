-- ExperienceLevel: add `master` for the FD V tier.
--
-- The five non-`any` levels now map 1:1 to FD certification ranks
-- (junior=FD I, mid=FD II, senior=FD III, lead=FD IV, master=FD V).
-- Recruiter copy in the position-create dialog renders the FD label;
-- the enum keys stay technical so older positions / API consumers
-- don't break.
--
-- IF NOT EXISTS keeps the migration re-runnable in dev (Prisma
-- migrate retries on partial failure) and idempotent across replicas.

ALTER TYPE "ExperienceLevel" ADD VALUE IF NOT EXISTS 'master';
