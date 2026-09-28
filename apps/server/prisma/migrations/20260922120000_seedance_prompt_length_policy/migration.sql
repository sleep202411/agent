-- Seedance 2.5 accepts a longer prompt than the historical generic BytePlus
-- fallback. Keep this model-specific so other BytePlus models remain unchanged.
UPDATE "ai_canonical_models"
SET "parameter_policy" = jsonb_set(
  COALESCE("parameter_policy", '{}'::jsonb),
  '{promptMaxLength}',
  '15000'::jsonb,
  true
)
WHERE "slug" = 'seedance-2-5'
  AND "archived_at" IS NULL;
