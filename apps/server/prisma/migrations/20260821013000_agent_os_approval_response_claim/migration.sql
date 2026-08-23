-- Cross-pod admission lease for generic Agent OS approval decisions.
-- ApprovalResolved + its correlated UserMessage remain the durable authority;
-- these nullable fields only fence concurrent Gateway/Worker dispatch before
-- one journal suffix wins. Existing runs remain valid without backfill.
ALTER TABLE "agent_os_runs"
  ADD COLUMN "approval_response_id" UUID,
  ADD COLUMN "approval_id" UUID,
  ADD COLUMN "approval_fingerprint" VARCHAR(64),
  ADD COLUMN "approval_response_lease_id" UUID,
  ADD COLUMN "approval_response_lease_expires_at" TIMESTAMPTZ(6);

ALTER TABLE "agent_os_runs"
  ADD CONSTRAINT "agent_os_runs_approval_response_claim_complete_check"
  CHECK (
    ("approval_response_id" IS NULL
      AND "approval_id" IS NULL
      AND "approval_fingerprint" IS NULL
      AND "approval_response_lease_id" IS NULL
      AND "approval_response_lease_expires_at" IS NULL)
    OR
    ("approval_response_id" IS NOT NULL
      AND "approval_id" IS NOT NULL
      AND "approval_fingerprint" IS NOT NULL
      AND "approval_response_lease_id" IS NOT NULL
      AND "approval_response_lease_expires_at" IS NOT NULL)
  );
