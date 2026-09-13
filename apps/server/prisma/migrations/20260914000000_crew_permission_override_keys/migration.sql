-- Preserve legacy finance records without mapping them to new grants.
-- Match current assignable permissions; owner-only actions remain excluded.
ALTER TABLE "crew_member_permission_overrides"
  DROP CONSTRAINT "crew_member_permission_overrides_key_chk",
  ADD CONSTRAINT "crew_member_permission_overrides_key_chk" CHECK (
    "permission_key" IN (
      'crew.settings.manage',
      'members.view',
      'members.invite',
      'members.manage',
      'openings.manage',
      'applications.review',
      'tasks.view',
      'tasks.manage',
      'tasks.comment',
      'tasks.submit_assigned',
      'tasks.review',
      'assets.view',
      'assets.upload',
      'assets.manage',
      'agreements.view_own',
      'agreements.manage',
      'finance.ledger.view',
      'finance.earnings.create',
      'finance.earnings.approve',
      'finance.earnings.reverse',
      'finance.payouts.create',
      'finance.payouts.manage',
      'studio.view',
      'studio.edit',
      'production.view',
      'production.deliver',
      'production.manage',
      'production.review',
      'finance.view',
      'finance.settle'
    )
  );
