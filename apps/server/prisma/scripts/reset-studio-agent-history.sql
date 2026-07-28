-- ============================================================================
-- Studio Agent history reset — the destructive half of the Ably cutover.
--
-- RUN THIS BY HAND, ONCE, AT CUTOVER. It is deliberately NOT a Prisma
-- migration: a destructive statement that rides a deploy has already cost this
-- repo a PITR restore, and there is no reason for a table wipe to be coupled to
-- a schema change that is safe.
--
-- WHY A WIPE AND NOT A BACKFILL.
--   Delivery moved from a hand-rolled Postgres relay to `@ably/ai-transport`.
--   Every pre-cutover run has `delivery_input_event_id IS NULL`, meaning "this
--   run has no triggering event on any Ably channel". There is nothing to
--   backfill it FROM — the input events never existed, because the channel
--   never carried them. A pre-cutover turn therefore cannot be opened on the
--   channel: `openAgentRun` would no-op and the browser would watch a run that
--   never streams. The owner authorised wiping studio-agent history precisely so
--   that no compatibility code has to exist for that state.
--
-- WHAT IT DOES NOT TOUCH. Nothing outside the `studio_agent_*` tables. Media
-- rows are left alone — dropping every artifact un-references the blobs those
-- threads held, so the orphan-media sweep is what reclaims them, and the last
-- statement below rewinds its watermark so it actually re-walks them instead of
-- skipping everything it had already adjudicated.
--
-- HOW TO RUN IT. The guard below aborts unless the server is reached over a
-- unix socket or a loopback address. `inet_server_addr()` returns NULL for a
-- unix-socket connection and the SERVER's own address otherwise — so a
-- tunnelled or port-forwarded database, which is exactly how a production host
-- gets mistaken for a local one, is caught: it reports the remote server's
-- address, not 127.0.0.1.
--
-- That also means `-h 127.0.0.1 -p 5433` against a CONTAINERISED local Postgres
-- is refused, because the server sees itself at 172.17.x.x. Run it inside the
-- container, over the socket:
--
--     docker cp apps/server/prisma/scripts/reset-studio-agent-history.sql \
--       <container>:/tmp/reset.sql
--     docker exec <container> psql -U postgres -d fizzdragon \
--       -v ON_ERROR_STOP=1 -f /tmp/reset.sql
--
-- Being locked out of a bare-metal remote is the point. If you are certain you
-- want this against a managed database, that is a decision for a human with the
-- rollback plan in hand, not a flag on a script.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  server_addr inet := inet_server_addr();
BEGIN
  IF server_addr IS NOT NULL AND NOT (server_addr <<= inet '127.0.0.0/8' OR server_addr = inet '::1') THEN
    RAISE EXCEPTION
      'reset-studio-agent-history refused: the server is at %, which is not loopback. This script wipes every Studio Agent thread and must never run against a shared or production database.',
      server_addr;
  END IF;
END
$$;

-- DELETE, never TRUNCATE. TRUNCATE cannot be filtered, bypasses the row triggers
-- this schema relies on, and — the reason that matters here — reads identically
-- whether it was aimed at the right table or the wrong one. Every statement
-- below names `studio_agent_%` and nothing else.

-- Two tables cannot be reached by a cascade and go first:
--   `studio_agent_approvals.thread_id` is NO ACTION, so a thread delete would
--     raise on it rather than clear it;
--   `studio_agent_orphan_media_cleanup_jobs` hangs off media_assets and has no
--     thread edge at all.
DELETE FROM "studio_agent_approvals";
DELETE FROM "studio_agent_orphan_media_cleanup_jobs";

-- Everything else falls out of ONE statement, and that is deliberate rather
-- than lazy. The graph is genuinely circular — a run points at its trigger
-- message, that message points back at its run, and the thread points at its
-- active run — so no hand-written child-first order exists. Nulling the edges
-- first is what the earlier draft of this script did, and PostgreSQL rejected
-- it: `studio_agent_guard_run_hierarchy()` raises "run identity and execution
-- snapshot are immutable" on any UPDATE that touches those columns, which is
-- the schema correctly refusing to let history be edited.
--
-- One cascading DELETE sidesteps the cycle entirely. Those circular edges are
-- NO ACTION, not RESTRICT, and NO ACTION is checked at the END of the
-- statement — by which point every row on both sides of every edge is gone, so
-- there is nothing left to violate. The cascade reaches messages, runs, events,
-- activities, inputs, actions, artifacts, checkpoints, model attempts, quota
-- charge attempts, the command outbox, and (through runs) run budgets.
DELETE FROM "studio_agent_threads";

-- Rewind the orphan-discovery watermark rather than deleting the row: the table
-- carries a `CHECK (id = 'singleton')` and the sweep expects exactly one row, so
-- deleting it breaks cleanup instead of resetting it. Every artifact above is
-- gone, which makes their media assets orphans — and without this rewind the
-- sweep would skip them forever, because it had already adjudicated them while
-- they were still attached.
UPDATE "studio_agent_orphan_discovery_cursor"
SET "scanned_through_created_at" = '-infinity'::TIMESTAMPTZ,
    "scanned_through_asset_id" = '00000000-0000-0000-0000-000000000000'::UUID,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'singleton';

COMMIT;
