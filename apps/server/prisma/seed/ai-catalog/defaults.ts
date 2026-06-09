/**
 * Shared policy templates for the AI image catalog seed.
 *
 * These blocks are written ONCE here and merged with per-model overrides in
 * `seed-catalog.ts`. Only the fields explicitly threaded through the factory
 * functions vary per model — everything else is identical across the catalog,
 * which keeps the data file (`image-models.ts`) declarative and free of policy
 * boilerplate.
 *
 * Currency is always `compute_point` / `COMPUTE_POINTS` (never `bubble`).
 */
import type { Prisma } from '@prisma/client';
import type { AiProductPricingPolicy } from '@repo/shared';

/** Plan tiers used by `entitlementPolicy.requiredPlan`. `null` = free tier. */
export type RequiredPlan = 'vip' | null;

/**
 * GPT Image 2 `parameterPolicy`. Parameter policies are per ContainerModel:
 * provider endpoints are implementation details, but the user-facing controls
 * must accurately describe the selected canonical model.
 */
export const GPT_IMAGE_2_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  defaultAspectRatio: '4:3',
  supportedAspectRatios: [
    '1:1',
    '4:3',
    '3:4',
    '16:9',
    '9:16',
    '3:2',
    '2:3',
    '21:9',
  ],
  defaultVariations: 1,
  variationOptions: [1, 2, 3, 4],
  defaultResolution: '1K',
  resolutionOptions: ['1K', '2K', '4K'],
  defaultQuality: 'medium',
  qualityOptions: ['low', 'medium', 'high'],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png', 'jpeg', 'webp'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 4,
    maskSupported: true,
  },
} as const satisfies Prisma.InputJsonObject;

export const NANO_BANANA_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: [
    '1:1',
    '4:3',
    '3:4',
    '16:9',
    '9:16',
    '3:2',
    '2:3',
    '4:5',
    '5:4',
    '21:9',
  ],
  defaultVariations: 1,
  variationOptions: [1],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png', 'jpeg'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 4,
    maskSupported: false,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

export const NANO_BANANA_2_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: [
    '1:1',
    '4:3',
    '3:4',
    '16:9',
    '9:16',
    '3:2',
    '2:3',
    '4:5',
    '5:4',
    '21:9',
  ],
  advancedAspectRatios: ['4:1', '1:4', '8:1', '1:8'],
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '1K',
  resolutionOptions: ['1K', '2K', '4K'],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png', 'jpeg'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 14,
    maskSupported: false,
  },
  seed: { enabled: false },
  webSearch: { enabled: false },
  thinking: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

export const NANO_BANANA_PRO_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: [
    '1:1',
    '4:3',
    '3:4',
    '16:9',
    '9:16',
    '3:2',
    '2:3',
    '4:5',
    '5:4',
    '21:9',
  ],
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '2K',
  resolutionOptions: ['2K', '4K'],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png', 'jpeg'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 14,
    maskSupported: false,
  },
  seed: { enabled: false },
  webSearch: { enabled: false },
  replicateFallbackModel: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

const SEEDREAM_BASE_ASPECT_RATIOS = [
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '21:9',
] as const;

const SEEDREAM_EXTENDED_ASPECT_RATIOS = [
  ...SEEDREAM_BASE_ASPECT_RATIOS,
  '4:5',
  '5:4',
  '9:21',
] as const;

const SEEDREAM_REFERENCE_IMAGES = {
  enabled: true,
  min: 0,
  max: 14,
  maskSupported: false,
} as const;

const BAILIAN_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '4:5',
  '5:4',
  '21:9',
] as const;

const FLUX_2_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '4:5',
  '5:4',
  '21:9',
] as const;

export const WAN_IMAGE_27_PRO_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'wan-image-2.7',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: BAILIAN_IMAGE_ASPECT_RATIOS,
  advancedAspectRatios: ['8:1', '1:8'],
  defaultVariations: 1,
  variationOptions: [1, 2, 3, 4],
  defaultResolution: '2K',
  resolutionOptions: ['1K', '2K', '4K'],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 9,
    maskSupported: true,
  },
  bboxList: { enabled: true },
  colorPalette: { enabled: true },
  thinkingMode: { enabled: true, default: true },
  promptExtend: { enabled: false },
  watermark: { enabled: true, default: false },
  seed: { enabled: true, minimum: 0, maximum: 2_147_483_647 },
} as const satisfies Prisma.InputJsonObject;

export const WAN_IMAGE_27_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'wan-image-2.7',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: BAILIAN_IMAGE_ASPECT_RATIOS,
  advancedAspectRatios: ['8:1', '1:8'],
  defaultVariations: 1,
  variationOptions: [1, 2, 3, 4],
  defaultResolution: '2K',
  resolutionOptions: ['1K', '2K'],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 9,
    maskSupported: true,
  },
  bboxList: { enabled: true },
  colorPalette: { enabled: true },
  thinkingMode: { enabled: true, default: true },
  promptExtend: { enabled: false },
  watermark: { enabled: true, default: false },
  seed: { enabled: true, minimum: 0, maximum: 2_147_483_647 },
} as const satisfies Prisma.InputJsonObject;

export const QWEN_IMAGE_20_PRO_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'qwen-image-2.0',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: BAILIAN_IMAGE_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1, 2, 3, 4, 5, 6],
  defaultResolution: '2K',
  resolutionOptions: ['1K', '2K'],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png'],
  negativePrompt: { enabled: true, maxLength: 500 },
  referenceImages: {
    enabled: true,
    min: 0,
    max: 3,
    maskSupported: false,
  },
  promptExtend: { enabled: true, default: true },
  watermark: { enabled: true, default: false },
  seed: { enabled: true, minimum: 0, maximum: 2_147_483_647 },
} as const satisfies Prisma.InputJsonObject;

export const QWEN_IMAGE_20_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'qwen-image-2.0',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: BAILIAN_IMAGE_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1, 2, 3, 4, 5, 6],
  defaultResolution: '2K',
  resolutionOptions: ['1K', '2K'],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png'],
  negativePrompt: { enabled: true, maxLength: 500 },
  referenceImages: {
    enabled: true,
    min: 0,
    max: 3,
    maskSupported: false,
  },
  promptExtend: { enabled: true, default: true },
  watermark: { enabled: true, default: false },
  seed: { enabled: true, minimum: 0, maximum: 2_147_483_647 },
} as const satisfies Prisma.InputJsonObject;

export const FLUX_2_PRO_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'flux-2',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: FLUX_2_IMAGE_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '1K',
  resolutionOptions: ['1K', '2K'],
  defaultOutputFormat: 'jpeg',
  outputFormatOptions: ['jpeg', 'png'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 8,
    maskSupported: false,
  },
  safetyTolerance: { enabled: false, default: 2 },
  promptUpsampling: { enabled: false, default: false },
  seed: { enabled: true, minimum: 0, maximum: 2_147_483_647 },
} as const satisfies Prisma.InputJsonObject;

export const FLUX_2_FLEX_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'flux-2',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: FLUX_2_IMAGE_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '1K',
  resolutionOptions: ['1K', '2K'],
  defaultOutputFormat: 'jpeg',
  outputFormatOptions: ['jpeg', 'png'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 10,
    maskSupported: false,
  },
  safetyTolerance: { enabled: false, default: 2 },
  promptUpsampling: { enabled: false, default: false },
  guidanceScale: {
    enabled: true,
    default: 3.5,
    minimum: 1.5,
    maximum: 10,
    step: 0.5,
  },
  inferenceSteps: {
    enabled: true,
    default: 28,
    minimum: 1,
    maximum: 50,
  },
  seed: { enabled: true, minimum: 0, maximum: 2_147_483_647 },
} as const satisfies Prisma.InputJsonObject;

// FLUX.2 [max] — premium zero-config tier (no guidance/steps; one image/request).
// Provider union across fal-ai/flux-2-max + replicate black-forest-labs/flux-2-max.
export const FLUX_2_MAX_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'flux-2',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: FLUX_2_IMAGE_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '1K',
  resolutionOptions: ['1K', '2K'],
  defaultOutputFormat: 'jpeg',
  outputFormatOptions: ['jpeg', 'png', 'webp'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 8,
    maskSupported: false,
  },
  safetyTolerance: { enabled: false, default: 2 },
  promptUpsampling: { enabled: false, default: false },
  seed: { enabled: true, minimum: 0, maximum: 2_147_483_647 },
} as const satisfies Prisma.InputJsonObject;

// FLUX.2 [dev] — open-weight base tier. Provider union: fal exposes guidance +
// inference steps + up to 4 images; replicate is distilled (no steps). The union
// keeps the richer fal controls; replicate routing ignores unsupported fields.
export const FLUX_2_DEV_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'flux-2',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: FLUX_2_IMAGE_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1, 2, 3, 4],
  defaultResolution: '1K',
  resolutionOptions: ['1K', '2K'],
  defaultOutputFormat: 'jpeg',
  outputFormatOptions: ['jpeg', 'png', 'webp'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 4,
    maskSupported: false,
  },
  safetyTolerance: { enabled: false, default: 2 },
  promptUpsampling: { enabled: false, default: false },
  guidanceScale: {
    enabled: true,
    default: 2.5,
    minimum: 1,
    maximum: 10,
    step: 0.5,
  },
  inferenceSteps: {
    enabled: true,
    default: 28,
    minimum: 4,
    maximum: 50,
  },
  seed: { enabled: true, minimum: 0, maximum: 2_147_483_647 },
} as const satisfies Prisma.InputJsonObject;

export const SEEDREAM_4_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: SEEDREAM_BASE_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '2K',
  resolutionOptions: ['1K', '2K', '4K'],
  referenceImages: SEEDREAM_REFERENCE_IMAGES,
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

export const SEEDREAM_45_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: SEEDREAM_EXTENDED_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '2K',
  resolutionOptions: ['2K', '4K'],
  referenceImages: SEEDREAM_REFERENCE_IMAGES,
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

export const SEEDREAM_5_LITE_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: SEEDREAM_BASE_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '2K',
  resolutionOptions: ['2K', '3K', '4K'],
  referenceImages: SEEDREAM_REFERENCE_IMAGES,
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

export const GPT_IMAGE_2_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'gpt-image-2-points-v1-2026-06-07',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'medium',
  resolutionOptions: ['1K', '2K', '4K'],
  qualityOptions: ['low', 'medium', 'high'],
  matrix: {
    '1K': { low: 20, medium: 60, high: 120 },
    '2K': { low: 30, medium: 90, high: 180 },
    '4K': { low: 45, medium: 140, high: 280 },
  },
  referenceImageSurchargePoints: 15,
  extraReferenceImagePoints: 5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const NANO_BANANA_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'fixed_per_output',
  version: 'nano-banana-points-v1-2026-06-08',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  pointsPerOutput: 10,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const NANO_BANANA_2_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'nano-banana-2-points-v1-2026-06-08',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 20 },
    '2K': { standard: 30 },
    '4K': { standard: 50 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const NANO_BANANA_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'nano-banana-pro-points-v1-2026-06-08',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '2K': { standard: 50 },
    '4K': { standard: 90 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const WAN_IMAGE_27_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'wan-image-2-7-pro-points-v1-2026-06-09',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 25 },
    '2K': { standard: 45 },
    '4K': { standard: 90 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const WAN_IMAGE_27_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'wan-image-2-7-points-v1-2026-06-09',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 12 },
    '2K': { standard: 20 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const QWEN_IMAGE_20_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'fixed_per_output',
  version: 'qwen-image-2-0-pro-points-v1-2026-06-09',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 6,
  pointsPerOutput: 35,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const QWEN_IMAGE_20_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'fixed_per_output',
  version: 'qwen-image-2-0-points-v1-2026-06-09',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 6,
  pointsPerOutput: 20,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const FLUX_2_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'flux-2-pro-points-v1-2026-06-09',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 30 },
    '2K': { standard: 70 },
  },
  referenceImageSurchargePoints: 10,
  extraReferenceImagePoints: 5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const FLUX_2_FLEX_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'flux-2-flex-points-v1-2026-06-09',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 50 },
    '2K': { standard: 120 },
  },
  referenceImageSurchargePoints: 15,
  extraReferenceImagePoints: 5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// Premium flux tier. Cost basis: fal $0.07 first MP + $0.03/extra MP
// (1K≈1MP=$0.07, 2K≈4MP=$0.16). Points keep the ~10x flux margin.
export const FLUX_2_MAX_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'flux-2-max-points-v1-2026-06-09',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 70 },
    '2K': { standard: 160 },
  },
  referenceImageSurchargePoints: 15,
  extraReferenceImagePoints: 5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// Budget open-weight flux tier. Cost basis: $0.012/MP flat on both fal +
// replicate (1K≈$0.012, 2K≈4MP=$0.048). Up to 4 images/request on fal.
export const FLUX_2_DEV_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'flux-2-dev-points-v1-2026-06-09',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 12 },
    '2K': { standard: 40 },
  },
  referenceImageSurchargePoints: 5,
  extraReferenceImagePoints: 3,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const SEEDREAM_4_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'seedream-4-points-v1-2026-06-08',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 20 },
    '2K': { standard: 30 },
    '4K': { standard: 50 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const SEEDREAM_45_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'seedream-4-5-points-v1-2026-06-08',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '2K': { standard: 40 },
    '4K': { standard: 70 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const SEEDREAM_5_LITE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'seedream-5-lite-points-v1-2026-06-08',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['2K', '3K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '2K': { standard: 35 },
    '3K': { standard: 50 },
    '4K': { standard: 70 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

/** Canonical `outputPolicy` factory. Output count follows product pricing. */
export function buildOutputPolicy(
  productPricing: AiProductPricingPolicy,
): Prisma.InputJsonObject {
  return {
    outputTypes: ['image'],
    maxOutputs: productPricing.maxOutputCount,
    storeOriginalProviderOutput: true,
  };
}

/** Canonical `observabilityPolicy` — identical for every image model. */
export const OBSERVABILITY_POLICY = {
  traceInputSnapshot: true,
  traceProviderRequest: true,
  traceProviderResponse: true,
  redactInputFields: [],
  alertOnFailureRate: true,
  alertOnQueueWaitSeconds: 120,
} as const satisfies Prisma.InputJsonObject;

/** Queue name shared by every image binding/canonical model. */
export const IMAGE_QUEUE_NAME = 'ai-image-generation';

/**
 * `entitlementPolicy` factory — only `requiredPlan` varies. `freeUserVisible`
 * keeps the model in the public catalog; `providerSelectionPlan` gates manual
 * provider override behind VIP.
 */
export function buildEntitlementPolicy(
  requiredPlan: RequiredPlan,
): Prisma.InputJsonObject {
  return {
    requiredPlan,
    freeUserVisible: true,
    providerSelectionPlan: 'vip',
  };
}

/**
 * `billingPolicy` factory. `productPricing` is the user-facing price source;
 * provider request cost is recorded separately per job when a provider returns
 * usage/cost metadata.
 */
export function buildBillingPolicy(
  preflightCost: number,
  productPricing: AiProductPricingPolicy,
): Prisma.InputJsonObject {
  return {
    mode: 'charge',
    unit: 'compute_point',
    displayCurrency: 'COMPUTE_POINTS',
    preflightCost,
    finalCostSource: 'product_pricing',
    refundPolicy: 'refund_on_final_failure',
    productPricing: productPricing as unknown as Prisma.InputJsonValue,
  };
}

/**
 * `queuePolicy` factory — per-user limits and priority scale with whether the
 * model is gated (any non-null `requiredPlan` = paid tier gets higher caps and
 * queue priority).
 */
export function buildQueuePolicy(
  requiredPlan: RequiredPlan,
): Prisma.InputJsonObject {
  const gated = Boolean(requiredPlan);
  return {
    queueName: IMAGE_QUEUE_NAME,
    globalConcurrency: 12,
    perUserRunning: gated ? 2 : 1,
    perUserQueued: gated ? 12 : 8,
    priority: gated ? 10 : 0,
    maxProviderRuntimeSeconds: 600,
  };
}

/**
 * `uiPolicy` factory — display grouping/ordering. The constant display flags
 * are folded in here so callers only pass what actually varies.
 */
export function buildUiPolicy(args: {
  group: string;
  recommended: boolean;
  sortOrder: number;
}): Prisma.InputJsonObject {
  return {
    group: args.group,
    recommended: args.recommended,
    sortOrder: args.sortOrder,
    advancedVisible: true,
    showProviderName: false,
    showCostEstimate: true,
    showQueueEstimate: true,
  };
}

/** Tag stamped on every canonical model's `metadata.managedBy`. */
export const SEED_MANAGED_BY = 'local-seed';
/** Stable seed identity recorded in `metadata.seedName`. */
export const SEED_NAME = 'ai-image-canonical-models';

/**
 * `metadata` factory. Records the seed provenance plus the original provider
 * aliases (kept for traceability even though only account-backed providers get
 * a binding).
 */
export function buildMetadata(args: {
  providerAliases: string[];
  group: string;
  seededAt: string;
}): Prisma.InputJsonObject {
  return {
    managedBy: SEED_MANAGED_BY,
    seedName: SEED_NAME,
    seededAt: args.seededAt,
    providerAliases: args.providerAliases,
    displayGroup: args.group,
    explicitVersion: true,
  };
}
