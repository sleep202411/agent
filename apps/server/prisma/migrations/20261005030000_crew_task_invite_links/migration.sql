-- Existing Crew/community links remain unchanged. Task-bound links are single-use.
ALTER TABLE crew_invite_links
  ADD COLUMN task_id uuid,
  ADD COLUMN task_version integer,
  ADD CONSTRAINT crew_invite_links_task_crew_fk
    FOREIGN KEY (task_id, crew_id) REFERENCES crew_tasks(id, crew_id)
    ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT crew_invite_links_task_binding_chk CHECK (
    (task_id IS NULL AND task_version IS NULL)
    OR (task_id IS NOT NULL AND task_version IS NOT NULL AND task_version > 0
        AND kind = 'member' AND max_uses IS NOT NULL AND max_uses = 1)
  );
CREATE INDEX crew_invite_links_task_idx ON crew_invite_links(task_id);
