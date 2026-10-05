-- Keep the existing primary-file API consistent during rolling deployment too.
CREATE FUNCTION retain_primary_task_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.metadata->>'contractAssetNodeId') IS NOT DISTINCT FROM (NEW.metadata->>'contractAssetNodeId')
  THEN RETURN NEW; END IF;
  INSERT INTO crew_task_contract_files(task_id,asset_node_id,attached_by_user_id)
  SELECT NEW.id,n.id,CASE WHEN TG_OP='INSERT' THEN NEW.created_by_user_id ELSE NULL END
    FROM crew_asset_nodes n WHERE n.id::text=NEW.metadata->>'contractAssetNodeId'
      AND n.crew_id=NEW.crew_id AND n.kind='file'
  ON CONFLICT(task_id,asset_node_id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER retain_primary_task_contract AFTER INSERT OR UPDATE OF metadata ON crew_tasks
  FOR EACH ROW EXECUTE FUNCTION retain_primary_task_contract();
