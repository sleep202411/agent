-- Deploy with generation admission paused so old instances cannot admit jobs
-- between the payer snapshot and the new workspace-only admission code.
BEGIN;
ALTER TABLE workspaces ADD COLUMN default_for_user_id VARCHAR(64);
UPDATE workspaces SET default_for_user_id = owner_user_id
WHERE type = 'personal' AND deleted_at IS NULL;
CREATE UNIQUE INDEX workspaces_default_for_user_id_key ON workspaces(default_for_user_id);

-- Preserve the old payer on jobs admitted before this cutover. Settlements and
-- refunds continue to follow their existing holds; no wallet balance is moved.
WITH payers AS (
  SELECT job.id,
    CASE WHEN story.billing_mode = 'account' THEN account.owner_type::text
         WHEN story.id IS NULL AND home.type = 'team' THEN 'workspace'
         WHEN personal.id IS NOT NULL THEN 'workspace' ELSE 'user' END AS kind,
    CASE WHEN story.billing_mode = 'account' THEN account.owner_id
         WHEN story.id IS NULL AND home.type = 'team' THEN home.id::text
         WHEN personal.id IS NOT NULL THEN personal.id::text ELSE job.user_id END AS payer_id
  FROM ai_jobs AS job
  LEFT JOIN story_projects AS story ON story.id = job.story_project_id
  LEFT JOIN wallet_accounts AS account ON account.id = story.billing_account_id
  LEFT JOIN workspaces AS home ON home.id = job.workspace_id
  LEFT JOIN workspaces AS personal ON personal.default_for_user_id = job.user_id
  WHERE job.billing_subject_type IS NULL
)
UPDATE ai_jobs AS job
SET billing_subject_type = payers.kind::"BillingSubjectType", billing_subject_id = payers.payer_id
FROM payers WHERE job.id = payers.id;

ALTER TABLE story_projects DROP COLUMN billing_mode, DROP COLUMN billing_account_id;
DROP TYPE "StoryProjectBillingMode";
DROP INDEX workspaces_personal_owner_unique;
DROP INDEX workspaces_owner_type_idx;
ALTER TABLE workspaces DROP COLUMN type;
DROP TYPE "WorkspaceType";
CREATE INDEX workspaces_owner_idx ON workspaces(owner_user_id, deleted_at);
COMMIT;
