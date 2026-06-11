-- Install product-facing AI model parameter and pricing policies.
-- User-facing pricing lives in ai_canonical_models.billing_policy as versioned
-- product-pricing metadata. Request-level provider cost remains in
-- ai_cost_ledger_entries when a provider exposes actual usage/cost.

-- Existing databases do not automatically re-run seed data. Migrate the
-- product-facing image parameter policy in-place so the runtime catalog exposes
-- the same ContainerModel option surface after deploy.
--
-- Product scope for this release: GPT Image 2 only. Provider endpoints begin
-- with fal.ai and Replicate. Other image ContainerModels and their endpoint
-- bindings are intentionally removed until reviewed one by one.
DELETE FROM "ai_provider_model_bindings" b
USING "ai_canonical_models" c
WHERE b."canonical_model_id" = c."id"
  AND b."modality" = 'image'::"AiJobType"
  AND (
    c."slug" <> 'gpt-image-2'
    OR NOT (
      (b."provider" = 'fal-ai' AND b."endpoint_id" = 'openai/gpt-image-2')
      OR (b."provider" = 'replicate' AND b."endpoint_id" = 'openai/gpt-image-2')
    )
  );

DELETE FROM "ai_provider_endpoints"
WHERE "modality" = 'image'::"AiJobType"
  AND NOT (
    ("provider" = 'fal-ai' AND "endpoint_id" = 'openai/gpt-image-2')
    OR ("provider" = 'replicate' AND "endpoint_id" = 'openai/gpt-image-2')
  );

DELETE FROM "ai_canonical_models"
WHERE "modality" = 'image'::"AiJobType"
  AND "slug" <> 'gpt-image-2';

UPDATE "ai_canonical_models"
SET "parameter_policy" = jsonb_build_object(
    'parameterMode', 'provider_union',
    'defaultAspectRatio', '4:3',
    'supportedAspectRatios', jsonb_build_array(
      '1:1',
      '4:3',
      '3:4',
      '16:9',
      '9:16',
      '3:2',
      '2:3',
      '21:9'
    ),
    'defaultVariations', 1,
    'variationOptions', jsonb_build_array(1, 2, 3, 4),
    'defaultResolution', '1K',
    'resolutionOptions', jsonb_build_array('1K', '2K', '4K'),
    'defaultQuality', 'medium',
    'qualityOptions', jsonb_build_array('low', 'medium', 'high'),
    'defaultOutputFormat', 'png',
    'outputFormatOptions', jsonb_build_array('png', 'jpeg', 'webp'),
    'referenceImages', jsonb_build_object(
      'enabled', true,
      'min', 0,
      'max', 4,
      'maskSupported', true
    )
  )
WHERE "slug" = 'gpt-image-2'
  AND "archived_at" IS NULL;

-- GPT Image 2 product pricing is a versioned, immutable user-facing price
-- policy. Provider request costs are deliberately not stored here.
UPDATE "ai_canonical_models"
SET "billing_policy" = jsonb_build_object(
    'mode', 'charge',
    'unit', 'compute_point',
    'displayCurrency', 'COMPUTE_POINTS',
    'preflightCost', 60,
    'finalCostSource', 'product_pricing',
    'refundPolicy', 'refund_on_final_failure',
    'productPricing', jsonb_build_object(
      'mode', 'parameter_matrix',
      'version', 'gpt-image-2-points-v1-2026-06-07',
      'currency', 'COMPUTE_POINTS',
      'defaultOutputCount', 1,
      'minOutputCount', 1,
      'maxOutputCount', 4,
      'defaultResolution', '1K',
      'defaultQuality', 'medium',
      'resolutionOptions', jsonb_build_array('1K', '2K', '4K'),
      'qualityOptions', jsonb_build_array('low', 'medium', 'high'),
      'matrix', jsonb_build_object(
        '1K', jsonb_build_object('low', 20, 'medium', 60, 'high', 120),
        '2K', jsonb_build_object('low', 30, 'medium', 90, 'high', 180),
        '4K', jsonb_build_object('low', 45, 'medium', 140, 'high', 280)
      ),
      'referenceImageSurchargePoints', 15,
      'extraReferenceImagePoints', 5,
      'maskSurchargePoints', 0,
      'minimumPoints', 1,
      'roundTo', 1
    )
  )
WHERE "slug" = 'gpt-image-2'
  AND "archived_at" IS NULL;
