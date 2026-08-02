-- Task lifecycle belongs to the task activity log and targeted notifications,
-- not the crew conversation. Remove the historical chat copies and repair the
-- denormalized inbox sort timestamp to the newest message that remains.
WITH task_chat_messages AS (
  SELECT m.id, m.conversation_id
  FROM messages AS m
  WHERE m.type = 'system'::message_type
    AND m.payload ->> 'kind' = 'system'
    AND m.payload -> 'system' ->> 'kind' IN (
      'crew.task.created',
      'crew.task.submitted',
      'crew.task.revision_requested',
      'crew.task.approved',
      'crew.task.settled'
    )
),
replacement_activity AS (
  SELECT
    c.id AS conversation_id,
    COALESCE(MAX(m.created_at), c.created_at) AS last_message_at
  FROM conversations AS c
  JOIN (
    SELECT DISTINCT conversation_id
    FROM task_chat_messages
  ) AS affected
    ON affected.conversation_id = c.id
  LEFT JOIN messages AS m
    ON m.conversation_id = c.id
    AND NOT EXISTS (
      SELECT 1
      FROM task_chat_messages AS removed
      WHERE removed.id = m.id
    )
  GROUP BY c.id, c.created_at
),
deleted AS (
  DELETE FROM messages AS m
  USING task_chat_messages AS target
  WHERE m.id = target.id
  RETURNING m.conversation_id
)
UPDATE conversations AS c
SET last_message_at = replacement.last_message_at
FROM replacement_activity AS replacement
WHERE c.id = replacement.conversation_id
  AND EXISTS (
    SELECT 1
    FROM deleted
    WHERE deleted.conversation_id = c.id
  );
