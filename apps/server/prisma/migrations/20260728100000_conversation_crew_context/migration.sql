-- Crew group chat: one crew = one conversation, carried by the existing
-- Conversations module rather than a second messaging system.
--
-- Two enum values, and NOTHING ELSE, on purpose. PG12+ allows ADD VALUE
-- inside a transaction only as long as the new value is not *used* in the
-- same transaction, and Prisma wraps each migration file in one. Anything
-- that inserts/compares 'crew' or 'member' must therefore land in a later
-- migration. Same rule the canvas document type hit:
--   prisma/migrations/20260613120000_canvas_document_type/migration.sql
--
-- `member` is the only new participant role. Crew authorization lives in
-- CrewRoleService (founder/admin, finance, member); mirroring those onto
-- ConversationParticipant.role would duplicate state that mutates
-- independently, and participant.role carries no authorization weight for
-- crew conversations.

ALTER TYPE "conversation_context_type" ADD VALUE IF NOT EXISTS 'crew';

ALTER TYPE "conversation_participant_role" ADD VALUE IF NOT EXISTS 'member';
