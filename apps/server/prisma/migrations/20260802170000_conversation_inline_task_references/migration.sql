-- Task shares are ordinary chat messages with durable inline references.
-- Convert every historical task-card row before removing the enum value so
-- the application has one message rendering and send path.
BEGIN;

UPDATE messages AS message
SET
  type = 'text'::message_type,
  body = btrim(concat_ws(
    ' ',
    NULLIF(btrim(message.body), ''),
    '#' || format('TASK-%s %s', task.number, task.title)
  )),
  payload = jsonb_build_object(
      'kind', 'text',
      'tasks', jsonb_build_array(
        jsonb_build_object(
          'taskId', task.id,
          'crewId', task.crew_id,
          'number', task.number,
          'label', format('TASK-%s %s', task.number, task.title)
        )
      )
    ) || CASE
      WHEN message.payload ? 'mentions'
        THEN jsonb_build_object('mentions', message.payload -> 'mentions')
      ELSE '{}'::jsonb
    END
FROM crew_tasks AS task
WHERE message.type = 'task'::message_type
  AND task.id::text = message.payload #>> '{task,taskId}';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM messages WHERE type = 'task'::message_type) THEN
    RAISE EXCEPTION 'Cannot remove task message type: orphan task-card messages remain';
  END IF;
END $$;

-- These checks contain enum-typed literals. Recreate them around the enum
-- replacement so PostgreSQL never has to compare values from two distinct
-- enum types while rewriting the column.
ALTER TABLE messages
  DROP CONSTRAINT chk_messages_author_for_non_system,
  DROP CONSTRAINT chk_messages_body_for_text;

ALTER TYPE message_type RENAME TO message_type_with_task_card;
CREATE TYPE message_type AS ENUM ('text', 'image', 'file', 'proposal', 'system');
ALTER TABLE messages
  ALTER COLUMN type TYPE message_type
  USING (type::text::message_type);
DROP TYPE message_type_with_task_card;

ALTER TABLE messages
  ADD CONSTRAINT chk_messages_author_for_non_system
    CHECK (type = 'system'::message_type OR (author_id IS NOT NULL AND length(btrim(author_id)) > 0)),
  ADD CONSTRAINT chk_messages_body_for_text
    CHECK (type <> 'text'::message_type OR length(btrim(body)) > 0);

COMMIT;
