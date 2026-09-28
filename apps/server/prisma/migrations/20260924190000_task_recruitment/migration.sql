ALTER TABLE crew_positions ADD COLUMN task_id UUID;
ALTER TABLE crew_positions ADD CONSTRAINT crew_positions_task_id_crew_id_fkey FOREIGN KEY (task_id, crew_id) REFERENCES crew_tasks(id, crew_id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX crew_positions_task_id_crew_id_idx ON crew_positions(task_id, crew_id);
