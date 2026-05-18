-- Normalize AiJobStatus enum to lowercase snake_case so it matches
-- the convention used by every other enum in the schema (AiJobStage,
-- AiAttemptStatus, AiProviderEventType, AiOutboxEventType, AiJobType).
--
-- `ALTER TYPE ... RENAME VALUE ...` is preferred over CREATE+ALTER+
-- DROP because it keeps existing rows intact and works inside a
-- single transaction. No code or data path needs to migrate state.
ALTER TYPE "AiJobStatus" RENAME VALUE 'CREATED'     TO 'created';
ALTER TYPE "AiJobStatus" RENAME VALUE 'IN_QUEUE'    TO 'in_queue';
ALTER TYPE "AiJobStatus" RENAME VALUE 'IN_PROGRESS' TO 'in_progress';
ALTER TYPE "AiJobStatus" RENAME VALUE 'COMPLETED'   TO 'completed';
ALTER TYPE "AiJobStatus" RENAME VALUE 'FAILED'      TO 'failed';
ALTER TYPE "AiJobStatus" RENAME VALUE 'CANCELLED'   TO 'cancelled';
ALTER TYPE "AiJobStatus" RENAME VALUE 'EXPIRED'     TO 'expired';
