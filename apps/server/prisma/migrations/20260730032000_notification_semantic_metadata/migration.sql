-- Historical notification rows predate locale-neutral semantic metadata.
-- Backfill from authoritative crew task records so every reader can render
-- old inbox entries in their active locale without rewriting authored text.

BEGIN;

UPDATE notifications AS notification
SET meta = notification.meta || jsonb_build_object('taskTitle', task.title)
FROM crew_tasks AS task
WHERE notification.type IN (
  'crew.task.assigned',
  'crew.task.updated',
  'crew.task.commented',
  'crew.task.mentioned',
  'crew.task.submitted',
  'crew.task.approved',
  'crew.task.revision_requested',
  'crew.settlement.settled'
)
  AND notification.meta ->> 'taskId' = task.id::text
  AND COALESCE(notification.meta ->> 'taskTitle', '') = '';

UPDATE notifications AS notification
SET meta = notification.meta || jsonb_build_object(
  'submissionVersion',
  submission.version_number
)
FROM crew_task_submissions AS submission
WHERE notification.type = 'crew.task.submitted'
  AND notification.meta ->> 'submissionId' = submission.id::text
  AND NOT (notification.meta ? 'submissionVersion');

-- Preserve human review notes. Default English producer copy is deliberately
-- omitted so the locale renderer can supply its translated default instead.
UPDATE notifications
SET meta = meta || jsonb_build_object('reviewNote', body)
WHERE type IN ('crew.task.approved', 'crew.task.revision_requested')
  AND COALESCE(meta ->> 'reviewNote', '') = ''
  AND body NOT IN (
    'Your work was approved.',
    'Open the task canvas and submit a new version.'
  );

UPDATE notifications AS notification
SET meta = notification.meta || jsonb_build_object(
  'pointsAmount',
  settlement.points_amount::text,
  'pointsPerUsd',
  settlement.points_per_usd,
  'payoutAmountMinor',
  settlement.payout_amount_minor::text,
  'payoutCurrency',
  settlement.payout_currency
)
FROM crew_settlement_items AS settlement
WHERE notification.type = 'crew.settlement.settled'
  AND notification.meta ->> 'settlementId' = settlement.id::text
  AND settlement.payout_amount_minor IS NOT NULL
  AND settlement.payout_currency IS NOT NULL
  AND (
    NOT (notification.meta ? 'pointsAmount')
    OR NOT (notification.meta ? 'payoutAmountMinor')
    OR NOT (notification.meta ? 'payoutCurrency')
  );

COMMIT;
