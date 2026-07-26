-- An AI job may pin the storage backend its outputs are written to.
--
-- WHY A COLUMN AND NOT CONFIG
--
-- Until now the writable backend was one process-wide binding
-- (`OUTPUT_STORAGE_PROVIDER`, resolved once at boot in StorageModule), so the
-- only two possible answers were "all media on Azure Blob" or "all media on
-- R2". Story Studio interactive-film footage is moving to R2 on its own, and
-- nothing else is, so the target has to be per-job.
--
-- It is FROZEN on the row at submit time rather than re-derived at upload
-- time because a job can upload more than once: the worker re-runs
-- `uploadOutputs` for a requeued attempt, and the object key is
-- content-addressed so the second attempt is meant to converge on the same
-- object. If attempt 2 read a since-changed default it would write the same
-- bytes into a different store and leave attempt 1's object orphaned in the
-- first one, with only one of the two reachable from the DB row.
--
-- WHY NULLABLE AND WHY NO DEFAULT
--
-- NULL is the load-bearing value: "use whatever binding this cell resolved".
-- Every existing row and every caller that does not opt in keeps writing
-- exactly where it writes today, so this migration needs no backfill and
-- changes no behavior on its own. A DEFAULT would turn a future
-- StorageModule change into a silent per-row lie, so there is none.
--
-- WHY external_url IS REJECTED
--
-- `MediaStorageProvider` also covers `external_url`, which is not a backend
-- at all — it marks an asset whose bytes live somewhere we do not control, so
-- `StorageProviderRegistry.forProvider` has no implementation to return for
-- it. A row carrying it could only ever fail the upload, and it would fail
-- deep in the worker instead of at the write that created it.
--
-- LOCKING
--
-- Prisma runs the whole file in one transaction, so every lock it takes is held
-- until commit — and it commits from the new pod's `db-migrate` init container
-- (deploy/helm/fizzdragon/templates/server.yaml) while the previous image is
-- still serving the AI plane. `ai_jobs` is the busiest table on that plane and
-- grows without bound, so neither statement may touch the heap. ADD COLUMN of a
-- nullable enum with no default is catalog-only. The CHECK is `NOT VALID`,
-- which is what keeps it catalog-only too: a validating ADD CONSTRAINT would
-- read every row of `ai_jobs` under ACCESS EXCLUSIVE, blocking the running
-- pods' reads and writes for the length of that scan. Both statements take a
-- brief ACCESS EXCLUSIVE and no scan.
--
-- `NOT VALID` costs nothing here. It suppresses only the retroactive proof, and
-- there is nothing to prove: the column is being created in this same
-- transaction with no default and no backfill, so it is NULL on every existing
-- row and the constraint's first conjunct already admits every one of them. It
-- is fully enforced on every INSERT and UPDATE from commit onward, which is the
-- entire point of it. No later `VALIDATE CONSTRAINT` is needed or planned.

ALTER TABLE "ai_jobs"
  ADD COLUMN "output_storage_provider" "MediaStorageProvider";

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_output_storage_provider_chk" CHECK (
    "output_storage_provider" IS NULL OR
    "output_storage_provider" <> 'external_url'
  ) NOT VALID;
