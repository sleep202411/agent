-- Canonical compute memberships: one plan-key ladder, one benefits JSON, and
-- one workspace-wide pool of unique creator seats.

CREATE TYPE "WorkspaceMemberAccessScope" AS ENUM ('workspace', 'project_only');

ALTER TABLE "workspace_members"
  ADD COLUMN "access_scope" "WorkspaceMemberAccessScope" NOT NULL DEFAULT 'workspace';

-- Older Story sharing projected collaborators into workspace_members as plain
-- viewers. Preserve direct workspace additions/invite acceptances (both have
-- audit evidence), but narrow project-created viewer rows to project-only.
UPDATE "workspace_members" AS wm
SET "access_scope" = 'project_only'
WHERE wm."role" = 'viewer'
  AND wm."status" = 'active'
  AND wm."removed_at" IS NULL
  AND (
    EXISTS (
      SELECT 1
      FROM "project_members" AS pm
      INNER JOIN "platform_projects" AS p ON p."id" = pm."project_id"
      WHERE p."workspace_id" = wm."workspace_id"
        AND pm."user_id" = wm."user_id"
        AND pm."status" = 'active'
        AND pm."removed_at" IS NULL
        AND p."deleted_at" IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM "story_project_members" AS spm
      INNER JOIN "story_projects" AS sp ON sp."id" = spm."story_project_id"
      WHERE sp."workspace_id" = wm."workspace_id"
        AND spm."user_id" = wm."user_id"
        AND spm."status" = 'active'
        AND spm."removed_at" IS NULL
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "platform_audit_logs" AS audit
    WHERE audit."workspace_id" = wm."workspace_id"
      AND (
        (
          audit."action" = 'workspace.member.added'
          AND audit."entity_type" = 'workspace_member'
          AND audit."entity_id" = wm."id"::text
        )
        OR (
          audit."action" = 'workspace.invite.accepted'
          AND audit."actor_user_id" = wm."user_id"
        )
      )
  );

-- Generic project sharing historically needed no workspace row at all. Backfill
-- one roster projection per collaborator so every project participant appears
-- in the workspace directory without receiving workspace-wide access.
WITH project_collaborators AS (
  SELECT
    p."workspace_id",
    pm."user_id",
    pm."granted_by_id" AS "actor_user_id",
    pm."created_at"
  FROM "project_members" AS pm
  INNER JOIN "platform_projects" AS p ON p."id" = pm."project_id"
  WHERE pm."status" = 'active'
    AND pm."removed_at" IS NULL
    AND p."deleted_at" IS NULL

  UNION ALL

  SELECT
    sp."workspace_id",
    spm."user_id",
    spm."granted_by_user_id" AS "actor_user_id",
    spm."created_at"
  FROM "story_project_members" AS spm
  INNER JOIN "story_projects" AS sp ON sp."id" = spm."story_project_id"
  WHERE spm."status" = 'active'
    AND spm."removed_at" IS NULL
), first_collaboration AS (
  SELECT DISTINCT ON ("workspace_id", "user_id")
    "workspace_id",
    "user_id",
    "actor_user_id",
    "created_at"
  FROM project_collaborators
  ORDER BY "workspace_id", "user_id", "created_at" ASC
)
INSERT INTO "workspace_members" (
  "workspace_id",
  "user_id",
  "role",
  "status",
  "access_scope",
  "invited_by_id",
  "joined_at",
  "created_at",
  "updated_at"
)
SELECT
  collaboration."workspace_id",
  collaboration."user_id",
  'viewer',
  'active',
  'project_only',
  collaboration."actor_user_id",
  collaboration."created_at",
  collaboration."created_at",
  CURRENT_TIMESTAMP
FROM first_collaboration AS collaboration
WHERE NOT EXISTS (
  SELECT 1
  FROM "workspace_members" AS wm
  WHERE wm."workspace_id" = collaboration."workspace_id"
    AND wm."user_id" = collaboration."user_id"
    AND wm."removed_at" IS NULL
);

DROP INDEX IF EXISTS "workspace_members_scope_idx";
CREATE INDEX "workspace_members_scope_idx"
  ON "workspace_members" ("workspace_id", "access_scope", "status");

ALTER TABLE "workspace_members" DROP COLUMN "seat_assigned";

-- Remove the retired feature-switch object from every benefits document before
-- the strict MembershipBenefitsSchema starts reading the new shape.
UPDATE "billing_membership_plans"
SET "benefits" = "benefits" - 'features';

UPDATE "billing_membership_plans"
SET
  "rank" = 10,
  "benefits" = '{
    "queuePriority": 5,
    "imageDaily": 30,
    "videoDaily": 4,
    "chatDaily": 200,
    "workflowDaily": 10,
    "uploadMB": 1024,
    "chatPerMinute": 40,
    "concurrentJobs": 5,
    "queuedJobs": 10
  }'::jsonb
WHERE "plan_key" = 'basic';

UPDATE "billing_membership_plans"
SET
  "rank" = 20,
  "benefits" = '{
    "queuePriority": 4,
    "imageDaily": 60,
    "videoDaily": 10,
    "chatDaily": 350,
    "workflowDaily": 20,
    "uploadMB": 3072,
    "chatPerMinute": 50,
    "concurrentJobs": 8,
    "queuedJobs": 16
  }'::jsonb
WHERE "plan_key" = 'standard';

UPDATE "billing_membership_plans"
SET
  "rank" = 30,
  "benefits" = '{
    "queuePriority": 3,
    "imageDaily": 100,
    "videoDaily": 20,
    "chatDaily": 500,
    "workflowDaily": 30,
    "uploadMB": 5120,
    "chatPerMinute": 60,
    "concurrentJobs": 12,
    "queuedJobs": 24
  }'::jsonb
WHERE "plan_key" = 'pro';

UPDATE "billing_membership_plans"
SET
  "rank" = 40,
  "description" = 'Team workspace plan: shared compute credits and up to 28 unique creator seats across all projects.',
  "included_seats" = 28,
  "max_seats" = 28,
  "seat_overage_allowed" = false,
  "benefits" = '{
    "queuePriority": 2,
    "imageDaily": "Infinity",
    "videoDaily": "Infinity",
    "chatDaily": "Infinity",
    "workflowDaily": "Infinity",
    "uploadMB": 51200,
    "chatPerMinute": 100,
    "concurrentJobs": 28,
    "queuedJobs": 56
  }'::jsonb
WHERE "plan_key" = 'team';

UPDATE "billing_membership_plans"
SET "benefits" = '{
  "queuePriority": 10,
  "imageDaily": 5,
  "videoDaily": 0,
  "chatDaily": 30,
  "workflowDaily": 3,
  "uploadMB": 100,
  "chatPerMinute": 20,
  "concurrentJobs": 3,
  "queuedJobs": 6
}'::jsonb
WHERE "plan_key" = 'community_membership';

-- Preserve live customers while removing old vocabulary from entitlement
-- resolution. These are explicit one-time migrations, not runtime aliases.
UPDATE "entitlement_grants"
SET "plan_key" = CASE
  WHEN "plan_key" IN ('vip', 'basic') THEN 'basic'
  WHEN "plan_key" IN ('studio', 'standard') THEN 'standard'
  WHEN "plan_key" IN ('creator', 'enterprise', 'pro') THEN 'pro'
  WHEN "plan_key" IN (
    'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise', 'team'
  ) THEN 'team'
  ELSE "plan_key"
END
WHERE "plan_key" IN (
  'vip', 'studio', 'creator', 'enterprise',
  'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise'
);

UPDATE "billing_subscriptions"
SET "plan_key" = CASE
  WHEN "plan_key" IN ('vip', 'basic') THEN 'basic'
  WHEN "plan_key" IN ('studio', 'standard') THEN 'standard'
  WHEN "plan_key" IN ('creator', 'enterprise', 'pro') THEN 'pro'
  WHEN "plan_key" IN (
    'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise', 'team'
  ) THEN 'team'
  ELSE "plan_key"
END
WHERE "plan_key" IN (
  'vip', 'studio', 'creator', 'enterprise',
  'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise'
);

-- Existing provider subscriptions keep their historical price FK. Retire those
-- prices from new checkout, but rewrite the grant key so the next provider
-- renewal fulfils into the canonical plan instead of resurrecting an old key.
UPDATE "billing_provider_price_bindings"
SET
  "status" = 'inactive',
  "archived_at" = COALESCE("archived_at", CURRENT_TIMESTAMP)
WHERE "price_id" IN (
  SELECT "id"
  FROM "billing_prices"
  WHERE "grants_plan_key" IN (
    'vip', 'studio', 'creator', 'enterprise',
    'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise'
  )
);

UPDATE "billing_catalog_items"
SET
  "is_active" = false,
  "archived_at" = COALESCE("archived_at", CURRENT_TIMESTAMP)
WHERE "id" IN (
  SELECT "item_id"
  FROM "billing_prices"
  WHERE "grants_plan_key" IN (
    'vip', 'studio', 'creator', 'enterprise',
    'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise'
  )
);

UPDATE "billing_prices"
SET
  "grants_plan_key" = CASE
    WHEN "grants_plan_key" = 'vip' THEN 'basic'
    WHEN "grants_plan_key" = 'studio' THEN 'standard'
    WHEN "grants_plan_key" IN ('creator', 'enterprise') THEN 'pro'
    WHEN "grants_plan_key" IN (
      'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise'
    ) THEN 'team'
    ELSE "grants_plan_key"
  END,
  "is_active" = false,
  "archived_at" = COALESCE("archived_at", CURRENT_TIMESTAMP)
WHERE "grants_plan_key" IN (
  'vip', 'studio', 'creator', 'enterprise',
  'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise'
);

UPDATE "billing_membership_plans"
SET
  "status" = 'archived',
  "archived_at" = COALESCE("archived_at", CURRENT_TIMESTAMP)
WHERE "plan_key" IN (
  'vip', 'studio', 'creator', 'enterprise',
  'team_ultimate', 'team_creator', 'team_scale', 'team_enterprise'
);

-- Legacy VIP was previously normalized to null and therefore unlocked models.
-- Convert it once to the lowest paid canonical tier and delete the dead provider
-- selection flag from every model policy.
UPDATE "ai_canonical_models"
SET "entitlement_policy" =
  CASE
    WHEN "entitlement_policy" ->> 'requiredPlan' = 'vip'
      THEN jsonb_set(
        "entitlement_policy" - 'providerSelectionPlan',
        '{requiredPlan}',
        '"basic"'::jsonb,
        true
      )
    ELSE "entitlement_policy" - 'providerSelectionPlan'
  END;

-- benefits is now the sole membership policy/document returned to clients.
ALTER TABLE "billing_membership_plans"
  DROP COLUMN "feature_flags",
  DROP COLUMN "limits",
  DROP COLUMN "topup_discount_bps";
