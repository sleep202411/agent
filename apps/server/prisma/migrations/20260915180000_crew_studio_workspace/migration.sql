-- The internal Crew workspace is unchanged. External Studio sharing is explicit.
ALTER TABLE crews ADD COLUMN studio_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX crews_studio_workspace_unique ON crews(studio_workspace_id);
-- Existing project links are retained as history, not silently expanded to an
-- entire workspace without its owner's consent. A Crew admin must link again.
ALTER TABLE crew_asset_nodes ADD COLUMN source_canvas_project_id uuid REFERENCES platform_projects(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX crew_asset_canvas_folder_unique ON crew_asset_nodes(crew_id, source_canvas_project_id);
ALTER TABLE crew_asset_nodes ADD COLUMN shared_from_studio boolean NOT NULL DEFAULT false;
