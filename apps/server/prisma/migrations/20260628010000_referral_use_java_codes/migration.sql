-- Referral now uses Java's own per-user code (client_user.recommendation_code,
-- fetched via GET /user/recommendationcode) instead of a self-minted code.
-- Drop the redundant table — it has no foreign keys depending on it, and its
-- two unique indexes drop with it.
DROP TABLE IF EXISTS "referral_invite_codes";

-- ReferralAttribution.invite_code now stores the referrer's Java
-- recommendation_code (for audit). Widen to match Java's varchar(50) so longer
-- codes never truncate (widening never touches existing rows).
ALTER TABLE "referral_attributions"
  ALTER COLUMN "invite_code" SET DATA TYPE VARCHAR(50);
