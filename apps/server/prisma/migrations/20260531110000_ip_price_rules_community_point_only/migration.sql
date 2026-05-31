-- IP content purchase pricing is intentionally limited to community points.
-- Compute points are reserved for AI generation workloads and must not be
-- accepted as a content purchase currency.

UPDATE ip_price_rules
SET
  currency = 'community_point',
  updated_at = NOW()
WHERE currency <> 'community_point';

ALTER TABLE ip_price_rules
  DROP CONSTRAINT IF EXISTS ip_price_rules_currency_community_point_chk;

ALTER TABLE ip_price_rules
  ADD CONSTRAINT ip_price_rules_currency_community_point_chk
  CHECK (currency = 'community_point');
