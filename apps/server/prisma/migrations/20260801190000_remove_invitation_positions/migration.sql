-- Direct invitations establish membership only. Production positions are
-- assigned through recruitment approval or explicit member management.
ALTER TABLE "crew_invitations"
  DROP CONSTRAINT "crew_invitations_position_chk",
  DROP CONSTRAINT "crew_invitations_position_category_chk",
  DROP COLUMN "position_category_key",
  DROP COLUMN "position_title";
