-- Add `canvas` as a PlatformDocument mode (apps/studio React Flow node-graph).
-- Hand-written minimal migration (per the documents-schema drift lesson — do
-- NOT `prisma migrate dev`). PG12+ allows ADD VALUE in a transaction as long as
-- the new value is not used in the same transaction; kept in its own migration
-- so nothing references 'canvas' before it commits.
ALTER TYPE "PlatformDocumentType" ADD VALUE IF NOT EXISTS 'canvas';
