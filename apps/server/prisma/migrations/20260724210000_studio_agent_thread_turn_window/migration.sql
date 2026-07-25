-- Bounded thread snapshot. The snapshot is now a tail of whole turns, so the
-- root-run keyset scan and the per-run approval lookup each need a covering
-- index; every other windowed collection already leads with its run id.
--
-- Non-partial on purpose: the scan predicate is `parent_run_id IS NULL`, and a
-- partial index would be strictly smaller, but Prisma cannot express one in
-- @@index and shipping it would guarantee permanent `migrate diff` drift
-- against schema.prisma. Postgres indexes NULLs in btree and accepts IS NULL
-- as an indexable qualifier, so the four-column form serves the same scan.
CREATE INDEX "studio_agent_runs_thread_root_recent_idx"
  ON "studio_agent_runs" ("thread_id", "parent_run_id", "created_at" DESC, "id" DESC);

CREATE INDEX "studio_agent_approvals_run_requested_idx"
  ON "studio_agent_approvals" ("run_id", "requested_at", "id");
