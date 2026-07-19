-- Membership benefits unification: billing_membership_plans.benefits JSONB
-- becomes the SINGLE source of truth for plan quota limits / features /
-- queue priority (previously duplicated across quota tiers.config.ts TIERS
-- and entitlements PLAN_CONFIG — already diverged).
--
-- Backfill uses the entitlements PLAN_CONFIG numbers as canonical (the values
-- production admission actually enforced through EntitlementService).
-- Unlimited daily caps are stored as the JSON string "Infinity" (JSON has no
-- Infinity literal); MembershipBenefitsSchema on the server validates reads
-- and admin writes.
--
-- Rows whose plan_key is outside the compute-plan set (e.g.
-- community_membership — a separate access axis) receive free-equivalent
-- compute benefits: they are never consulted for compute admission.

ALTER TABLE "billing_membership_plans" ADD COLUMN "benefits" JSONB;

UPDATE "billing_membership_plans"
SET "benefits" = CASE "plan_key"
  WHEN 'basic' THEN '{
    "quotaTier": "VIP1", "queuePriority": 5,
    "imageDaily": 30, "videoDaily": 4, "chatDaily": 200, "workflowDaily": 10,
    "uploadMB": 1024, "chatPerMinute": 40,
    "concurrentJobs": 1, "queuedJobs": 4,
    "features": {"aiGeneration": true, "advancedModelAccess": true, "advancedParameters": false, "teamSharedCredits": false}
  }'::jsonb
  WHEN 'creator' THEN '{
    "quotaTier": "VIP1", "queuePriority": 5,
    "imageDaily": 30, "videoDaily": 4, "chatDaily": 200, "workflowDaily": 10,
    "uploadMB": 1024, "chatPerMinute": 40,
    "concurrentJobs": 1, "queuedJobs": 4,
    "features": {"aiGeneration": true, "advancedModelAccess": true, "advancedParameters": false, "teamSharedCredits": false}
  }'::jsonb
  WHEN 'standard' THEN '{
    "quotaTier": "VIP2", "queuePriority": 4,
    "imageDaily": 60, "videoDaily": 10, "chatDaily": 350, "workflowDaily": 20,
    "uploadMB": 3072, "chatPerMinute": 50,
    "concurrentJobs": 2, "queuedJobs": 6,
    "features": {"aiGeneration": true, "advancedModelAccess": true, "advancedParameters": true, "teamSharedCredits": false}
  }'::jsonb
  WHEN 'pro' THEN '{
    "quotaTier": "VIP3", "queuePriority": 3,
    "imageDaily": 100, "videoDaily": 20, "chatDaily": 500, "workflowDaily": 30,
    "uploadMB": 5120, "chatPerMinute": 60,
    "concurrentJobs": 3, "queuedJobs": 10,
    "features": {"aiGeneration": true, "advancedModelAccess": true, "advancedParameters": true, "teamSharedCredits": false}
  }'::jsonb
  WHEN 'studio' THEN '{
    "quotaTier": "VIP3", "queuePriority": 2,
    "imageDaily": "Infinity", "videoDaily": "Infinity", "chatDaily": "Infinity", "workflowDaily": "Infinity",
    "uploadMB": 30720, "chatPerMinute": 80,
    "concurrentJobs": 5, "queuedJobs": 16,
    "features": {"aiGeneration": true, "advancedModelAccess": true, "advancedParameters": true, "teamSharedCredits": false}
  }'::jsonb
  WHEN 'enterprise' THEN '{
    "quotaTier": "VIP3", "queuePriority": 1,
    "imageDaily": "Infinity", "videoDaily": "Infinity", "chatDaily": "Infinity", "workflowDaily": "Infinity",
    "uploadMB": 102400, "chatPerMinute": 120,
    "concurrentJobs": null, "queuedJobs": null,
    "features": {"aiGeneration": true, "advancedModelAccess": true, "advancedParameters": true, "teamSharedCredits": true}
  }'::jsonb
  WHEN 'team' THEN '{
    "quotaTier": "VIP3", "queuePriority": 2,
    "imageDaily": "Infinity", "videoDaily": "Infinity", "chatDaily": "Infinity", "workflowDaily": "Infinity",
    "uploadMB": 51200, "chatPerMinute": 100,
    "concurrentJobs": 8, "queuedJobs": 32,
    "features": {"aiGeneration": true, "advancedModelAccess": true, "advancedParameters": true, "teamSharedCredits": true}
  }'::jsonb
  WHEN 'team_enterprise' THEN '{
    "quotaTier": "VIP3", "queuePriority": 1,
    "imageDaily": "Infinity", "videoDaily": "Infinity", "chatDaily": "Infinity", "workflowDaily": "Infinity",
    "uploadMB": 204800, "chatPerMinute": 180,
    "concurrentJobs": null, "queuedJobs": null,
    "features": {"aiGeneration": true, "advancedModelAccess": true, "advancedParameters": true, "teamSharedCredits": true}
  }'::jsonb
  ELSE '{
    "quotaTier": "Free", "queuePriority": 10,
    "imageDaily": 5, "videoDaily": 0, "chatDaily": 30, "workflowDaily": 3,
    "uploadMB": 100, "chatPerMinute": 20,
    "concurrentJobs": 1, "queuedJobs": 2,
    "features": {"aiGeneration": true, "advancedModelAccess": false, "advancedParameters": false, "teamSharedCredits": false}
  }'::jsonb
END;

ALTER TABLE "billing_membership_plans" ALTER COLUMN "benefits" SET NOT NULL;

-- DB-level sanity: benefits is always a JSON object. Full shape validation
-- (MembershipBenefitsSchema) happens at every server read/write boundary.
ALTER TABLE "billing_membership_plans"
  ADD CONSTRAINT "billing_membership_plans_benefits_object_check"
  CHECK (jsonb_typeof("benefits") = 'object');
