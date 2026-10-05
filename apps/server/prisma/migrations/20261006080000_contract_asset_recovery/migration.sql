-- Historical unavailable contracts may be restored, but their content/name/location
-- and any active contract remain immutable. Restoring does not grant new access.
CREATE OR REPLACE FUNCTION guard_contract_asset_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ((OLD.name, OLD.parent_id, OLD.media_asset_id, OLD.kind)
      IS DISTINCT FROM (NEW.name, NEW.parent_id, NEW.media_asset_id, NEW.kind)
      OR (OLD.status IS DISTINCT FROM NEW.status AND NOT (OLD.status='trashed' AND NEW.status='active')))
    AND EXISTS (SELECT 1 FROM crew_task_contract_files WHERE asset_node_id=OLD.id)
  THEN RAISE EXCEPTION 'Attached task contract files are read-only'; END IF;
  RETURN NEW;
END; $$;
