-- The invitee welcome perk (新人礼) is now REGISTRATION-based and accrues lazily
-- on the referee's dashboard view. Enforce "at most one invitee reward per
-- referee" at the DB level so two concurrent dashboard loads can't double-grant.
-- Partial unique index (mirrors the milestone partial-unique precedent); the
-- accrual path swallows the P2002 a lost race produces.
CREATE UNIQUE INDEX "referral_reward_one_invitee_per_user"
  ON "referral_rewards" ("user_id") WHERE "kind" = 'invitee';
