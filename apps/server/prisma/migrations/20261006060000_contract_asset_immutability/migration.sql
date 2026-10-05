CREATE FUNCTION guard_contract_asset_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.name, OLD.parent_id, OLD.media_asset_id, OLD.kind, OLD.status)
    IS DISTINCT FROM (NEW.name, NEW.parent_id, NEW.media_asset_id, NEW.kind, NEW.status)
    AND EXISTS (SELECT 1 FROM crew_task_contract_files WHERE asset_node_id=OLD.id)
  THEN RAISE EXCEPTION 'Attached task contract files are read-only'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER contract_asset_read_only BEFORE UPDATE ON crew_asset_nodes
  FOR EACH ROW EXECUTE FUNCTION guard_contract_asset_edit();
