-- Remove Workspace.billingMode now that compute_point is uniformly
-- workspace-owned: every workspace is its own credit pot and spend/read/fund
-- resolve to the active workspace unconditionally, so the member_pays vs
-- workspace_pool mode no longer has any effect. Ships with the resolver change
-- (migration 20260615170000) that stopped reading this column.
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "billing_mode";
DROP TYPE IF EXISTS "WorkspaceBillingMode";
