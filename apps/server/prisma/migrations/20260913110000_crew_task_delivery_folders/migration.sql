CREATE TABLE crew_task_delivery_folders (
  task_id UUID PRIMARY KEY,
  crew_id TEXT NOT NULL,
  folder_id UUID NOT NULL,
  created_by_user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crew_task_delivery_folder_task_fk FOREIGN KEY (task_id, crew_id) REFERENCES crew_tasks(id, crew_id) ON DELETE CASCADE,
  CONSTRAINT crew_task_delivery_folder_node_fk FOREIGN KEY (folder_id, crew_id) REFERENCES crew_asset_nodes(id, crew_id) ON DELETE RESTRICT
);
CREATE INDEX crew_task_delivery_folders_node_idx ON crew_task_delivery_folders(folder_id);

ALTER TABLE crew_task_delivery_folders ADD CONSTRAINT crew_task_delivery_folders_task_crew_unique UNIQUE (task_id, crew_id);
CREATE TABLE crew_task_delivery_assets (
  task_id UUID NOT NULL,
  crew_id TEXT NOT NULL,
  asset_node_id UUID NOT NULL,
  PRIMARY KEY(task_id, asset_node_id),
  CONSTRAINT crew_task_delivery_assets_folder_fk FOREIGN KEY(task_id, crew_id) REFERENCES crew_task_delivery_folders(task_id, crew_id) ON DELETE CASCADE,
  CONSTRAINT crew_task_delivery_assets_node_fk FOREIGN KEY(asset_node_id, crew_id) REFERENCES crew_asset_nodes(id, crew_id) ON DELETE CASCADE
);
CREATE INDEX crew_task_delivery_assets_node_idx ON crew_task_delivery_assets(asset_node_id);
