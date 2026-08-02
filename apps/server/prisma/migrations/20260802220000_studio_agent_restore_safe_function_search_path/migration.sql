-- pg_restore clears the session search_path before loading table data. These
-- SQL validators call another public helper by its unqualified name, so pin
-- their function-local search path to keep production backups restorable.

BEGIN;

ALTER FUNCTION public.studio_agent_is_error(JSONB)
  SET search_path TO public, pg_catalog;

ALTER FUNCTION public.studio_agent_is_resource_ref(JSONB)
  SET search_path TO public, pg_catalog;

COMMIT;
