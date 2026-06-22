-- Widen billing_membership_plans_product_subject_shape to allow
-- community_membership_plan (subject = user). The community-membership migration
-- (20260621210000_community_membership) added the BillingProductType enum value
-- but never updated this CHECK constraint, so a community_membership plan row
-- could not be inserted into billing_membership_plans. DROP IF EXISTS keeps this
-- safe to re-run.
ALTER TABLE "billing_membership_plans"
  DROP CONSTRAINT IF EXISTS "billing_membership_plans_product_subject_shape";

ALTER TABLE "billing_membership_plans"
  ADD CONSTRAINT "billing_membership_plans_product_subject_shape"
  CHECK (
    ("product_type" = 'membership_plan' AND "subject_type" = 'user')
    OR ("product_type" = 'team_membership_plan' AND "subject_type" = 'workspace')
    OR ("product_type" = 'community_membership_plan' AND "subject_type" = 'user')
  );
