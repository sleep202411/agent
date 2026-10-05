CREATE TABLE crew_task_contract_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES crew_tasks(id) ON DELETE RESTRICT,
  asset_node_id uuid NOT NULL REFERENCES crew_asset_nodes(id) ON DELETE RESTRICT,
  attached_by_user_id varchar(64),
  attached_at timestamptz(6) DEFAULT now(),
  UNIQUE(task_id, asset_node_id)
);
CREATE INDEX crew_task_contract_files_asset_node_id_idx ON crew_task_contract_files(asset_node_id);
-- Preserve originals, including archived tasks. Do not infer a historical uploader.
INSERT INTO crew_task_contract_files(task_id, asset_node_id, attached_at)
SELECT t.id, n.id, NULL FROM crew_tasks t JOIN crew_asset_nodes n
  ON n.id::text = t.metadata->>'contractAssetNodeId' AND n.crew_id=t.crew_id
WHERE n.kind='file';
CREATE FUNCTION guard_task_contract_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Attached task contracts are immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM crew_tasks t JOIN crew_asset_nodes n ON n.crew_id=t.crew_id
    WHERE t.id=NEW.task_id AND n.id=NEW.asset_node_id AND n.kind='file')
  THEN RAISE EXCEPTION 'Contract file must belong to the task Crew'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER task_contract_file_guard BEFORE INSERT OR UPDATE OR DELETE ON crew_task_contract_files
  FOR EACH ROW EXECUTE FUNCTION guard_task_contract_file();
