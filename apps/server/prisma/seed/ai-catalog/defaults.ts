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
  providerFamily: 'gpt-image',
  // Aspect-driven via supportedAspectRatios; the fal request mapper converts
  // ratio + resolution into the `image_size: {width, height}` object that
  // openai/gpt-image-2 accepts (multiples of 16, max edge 3840):
  // https://fal.ai/models/openai/gpt-image-2/api
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
  providerFamily: 'nano-banana',
  // fal nano-banana endpoints take a native `aspect_ratio` enum (not
  // image_size): https://fal.ai/models/fal-ai/nano-banana/api
  aspectParameter: 'aspect_ratio',
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
  providerFamily: 'nano-banana',
  aspectParameter: 'aspect_ratio',
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
  providerFamily: 'nano-banana',
  aspectParameter: 'aspect_ratio',
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

// Seedream's documented reference-image cap is 10 ("up to 10 image inputs;
// if over 10 images are sent, only the last 10 will be used") — verified on
// fal for v4 and v4.5 edit: https://fal.ai/models/fal-ai/bytedance/seedream/v4/edit/api
// and https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit/api. The seed
// encodes the real cap so mappers no longer need a hardcoded clamp.
const SEEDREAM_REFERENCE_IMAGES = {
  enabled: true,
  min: 0,
  max: 10,
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

// Hunyuan World — image→panorama. ONE reference image (bound as a single
// `image_url`, not the `image_urls` array) + prompt → a 2:1 equirectangular
// panorama. Reached via the studio's 720° panorama action, not the picker.
export const HUNYUAN_WORLD_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'hunyuan',
  defaultVariations: 1,
  variationOptions: [1],
  referenceImages: {
    enabled: true,
    min: 1,
    max: 1,
    single: true,
    maskSupported: false,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// Topaz upscale: one input image → larger image. No prompt and none of the
// generation controls — the only user-facing param is the upscale factor
// (emitted by the fal-schema mapper's `upscale` branch).
export const TOPAZ_UPSCALE_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'topaz',
  defaultVariations: 1,
  variationOptions: [1],
  referenceImages: {
    enabled: true,
    min: 1,
    max: 1,
    single: true,
    maskSupported: false,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// Bria background removal: one input image → the same image with the background
// matted out (transparent). No prompt and no generation controls — the only
// input is the source image (emitted by the fal-schema mapper's pure-transform
// path). fal-ai/bria/background/remove takes just `image_url`.
export const BRIA_RMBG_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'bria',
  defaultVariations: 1,
  variationOptions: [1],
  referenceImages: {
    enabled: true,
    min: 1,
    max: 1,
    single: true,
    maskSupported: false,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// IC-Light V2 relight: a prompt-driven relighting op over a single source
// image. Unlike upscale/remove-bg it DOES take a prompt (describing the target
// lighting/scene) — so it is NOT a pure transform; it spawns an editable card.
// Its only op-specific control is the coarse light direction (initial_latent),
// emitted by the fal-schema mapper's `relight` branch alongside a preset output
// size + output count. fal-ai/iclight-v2 requires prompt + image_url.
export const ICLIGHT_RELIGHT_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'iclight',
  defaultVariations: 1,
  variationOptions: [1, 2, 3, 4],
  referenceImages: {
    enabled: true,
    min: 1,
    max: 1,
    single: true,
    maskSupported: false,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// Qwen multiple-angles: re-shoot a single source image from a new camera
// viewpoint. No prompt is required (an optional additional_prompt may refine
// it). Controls = horizontal orbit / vertical tilt / shot-size zoom, emitted by
// the fal-schema mapper's `multi_angle` branch. The endpoint takes image_urls
// (array), so referenceImages is non-single (binds image_urls).
export const QWEN_MULTI_ANGLE_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'qwen-multi-angle',
  defaultVariations: 1,
  variationOptions: [1, 2, 3, 4],
  referenceImages: {
    enabled: true,
    min: 1,
    max: 1,
    single: false,
    maskSupported: false,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// Bria expand (outpainting): grows the canvas around a single source image and
// generatively fills the new area. No required prompt (an optional one steers
// the fill). The studio's bespoke Expand editor produces the geometry
// (canvas_size + original placement), emitted by the mapper's outpainting
// branch. fal-ai/bria/expand requires image_url + canvas_size.
export const BRIA_EXPAND_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'bria-expand',
  defaultVariations: 1,
  variationOptions: [1],
  referenceImages: {
    enabled: true,
    min: 1,
    max: 1,
    single: true,
    maskSupported: false,
  },
  seed: { enabled: false },
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
// Aspect-driven: fal-ai/flux-2-max accepts `image_size` as preset token OR
// {width, height} object (https://fal.ai/models/fal-ai/flux-2-max/api); the
// request mapper converts ratio + resolution into the object form.
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
// Aspect-driven: fal-ai/flux-2 accepts `image_size` as preset token OR
// {width, height} object, 512–2048 px (https://fal.ai/models/fal-ai/flux-2/api);
// the request mapper converts ratio + resolution into the object form.
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
  providerFamily: 'seedream',
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
  providerFamily: 'seedream',
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
  providerFamily: 'seedream',
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

export const HUNYUAN_WORLD_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'hunyuan-world-points-v1-2026-06-11',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 40 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const TOPAZ_UPSCALE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'topaz-upscale-points-v1-2026-06-16',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 15 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const BRIA_RMBG_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'bria-rmbg-points-v1-2026-06-16',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 10 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const ICLIGHT_RELIGHT_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'iclight-relight-points-v1-2026-06-16',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 20 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const QWEN_MULTI_ANGLE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'qwen-multi-angle-points-v1-2026-06-16',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 18 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const BRIA_EXPAND_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'bria-expand-points-v1-2026-06-16',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 15 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
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

// ── Seedance 2.0 (ByteDance video) ──────────────────────────────
// Mode union (t2v / i2v / first-last-frame / omni-reference) lives on the
// canonical model; the param panel filters per selected mode. Reference (全能参考)
// is multimodal_to_video: ≤9 images / ≤3 videos / ≤3 audios.
const SEEDANCE_2_0_ASPECT_RATIOS = [
  'auto',
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
];
const SEEDANCE_2_0_DURATION_OPTIONS = [
  'auto',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
];

export const SEEDANCE_2_0_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'seedance',
  defaultResolution: '720p',
  resolutionOptions: ['480p', '720p'], // 1080p pending pricing approval
  // Default '5' (not 'auto'): 'auto' bills at the 15 s ceiling, so defaulting
  // to it would make the default quote the maximum price. 'auto' remains
  // selectable in durationOptions.
  defaultDurationSeconds: '5',
  durationOptions: SEEDANCE_2_0_DURATION_OPTIONS, // STRING enum incl. "auto"
  defaultAspectRatio: 'auto',
  supportedAspectRatios: SEEDANCE_2_0_ASPECT_RATIOS,
  generateAudio: { enabled: true, default: true },
  startFrame: { enabled: true }, // i2v first frame (image_url)
  endFrame: { enabled: true }, // i2v optional last frame (end_image_url)
  referenceInputs: {
    enabled: true, // 全能参考 / multimodal_to_video
    images: { min: 0, max: 9 },
    videos: { min: 0, max: 3 },
    audios: { min: 0, max: 3 },
    maxTotalFiles: 12,
  },
  seed: { enabled: true, minimum: 0, maximum: 2147483647 },
} as const satisfies Prisma.InputJsonObject;

// Per-second pricing matching fal's `video_seconds` billing. Points =
// ceil(fal USD/s × 2.0 margin × 100) (积分 ≡ US cent): 720p $0.3034/s → 61,
// 480p ≈ $0.185/s → 37. Duration 4–15 s; 'auto' quotes at the 15 s ceiling so
// the estimate can never undercharge the final per-second provider bill.
// 1080p stays ABSENT until its pricing is approved.
export const SEEDANCE_2_0_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'seedance-2-0-points-v2-2026-06-11',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '480p': 37, '720p': 61 },
  minSeconds: 4,
  maxSeconds: 15,
  defaultSeconds: 5,
  autoQuoteSeconds: 15,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// fast 720p $0.2419/s → 49; 480p ≈ $0.15/s → 30.
export const SEEDANCE_2_0_FAST_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'seedance-2-0-fast-points-v2-2026-06-11',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '480p': 30, '720p': 49 },
  minSeconds: 4,
  maxSeconds: 15,
  defaultSeconds: 5,
  autoQuoteSeconds: 15,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// Alibaba Tongyi Wanxiang (Wan) video. The Bailian video input schema is fixed
// in bailian-schema.mapper.ts (duration 3–10s int → parameters.duration;
// resolution 480P/720P/1080P → parameters.resolution; aspect 16:9/9:16/1:1), so
// this policy mirrors those exact values and the per-second pricing keys MUST be
// the uppercase resolution tiers the schema emits.
// Wan 2.7 video on Alibaba Model Studio (ap-southeast-1). One canonical, two
// upstream model ids: wan2.7-t2v (text→video) + wan2.7-i2v (image→video, which
// also covers first-last-frame via input.media first_frame/last_frame). Live
// API contract (probed 2026-06-16): resolution ∈ {720P,1080P} (no 480P),
// duration 2–15s, t2v ratio ∈ {16:9,9:16,1:1,4:3,3:4}; i2v derives ratio from
// the input frame. The Bailian video schema reads these keys (resolution/aspect
// options + min/max/default duration).
export const WAN_2_7_VIDEO_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'wan',
  defaultResolution: '720P',
  resolutionOptions: ['720P', '1080P'],
  defaultDurationSeconds: 5,
  minDurationSeconds: 2,
  maxDurationSeconds: 15,
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  startFrame: { enabled: true }, // i2v / first-last-frame (input.media)
  // wan2.7-r2v (参考生视频) accepts reference_image + reference_video (NOT audio).
  referenceTypes: ['reference_image', 'reference_video'],
  promptExtend: { enabled: true },
  seed: { enabled: true, minimum: 0, maximum: 2147483647 },
} as const satisfies Prisma.InputJsonObject;

// Wan 2.7 video — per-second points (积分 ≡ US cent). Resolution keys match the
// Bailian video schema enum; duration is an integer 2–15s.
// NOTE: per-second rates are an ESTIMATE anchored on the published INTERNATIONAL
// (ap-southeast-1) wan2.6 video tier as the wan2.7 proxy (720P $0.10/s, 1080P
// $0.15/s) at a 2.0× margin → ceil(USD/s × 100 × 2.0). Pending finance sign-off
// against Alibaba's published wan2.7 rate; DB-editable via the catalog ops flow.
export const WAN_2_7_VIDEO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'wan-2-7-video-points-v1-2026-06-16',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720P',
  pointsPerSecond: { '720P': 20, '1080P': 30 },
  minSeconds: 2,
  maxSeconds: 15,
  defaultSeconds: 5,
  autoQuoteSeconds: 15,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// HappyHorse 1.0 video on Alibaba Model Studio (ap-southeast-1). One canonical,
// three upstream ids: happyhorse-1.0-t2v (text→video, native synced audio +
// lip-sync), happyhorse-1.0-i2v (image→video, input.media first_frame),
// happyhorse-1.0-r2v (omni reference, input.media reference_image). Live-probed
// 2026-06-16: resolution {720P,1080P}, duration 2–15s, t2v ratio set is wider
// than Wan (16:9/9:16/4:3/3:4/1:1/5:4/4:5/9:21/21:9). i2v takes first_frame
// only (no last frame); r2v takes reference_image only (no video/audio ref).
export const HAPPYHORSE_VIDEO_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'happyhorse',
  defaultResolution: '720P',
  resolutionOptions: ['720P', '1080P'],
  defaultDurationSeconds: 5,
  minDurationSeconds: 2,
  maxDurationSeconds: 15,
  defaultAspectRatio: '16:9',
  supportedAspectRatios: [
    '16:9',
    '9:16',
    '4:3',
    '3:4',
    '1:1',
    '5:4',
    '4:5',
    '9:21',
    '21:9',
  ],
  startFrame: { enabled: true }, // i2v first frame (input.media)
  // happyhorse-1.0-r2v accepts ONLY reference_image.
  referenceTypes: ['reference_image'],
  promptExtend: { enabled: true },
  seed: { enabled: true, minimum: 0, maximum: 2147483647 },
} as const satisfies Prisma.InputJsonObject;

// HappyHorse 1.0 — per-second points (积分 ≡ US cent). ESTIMATE: HappyHorse is a
// premium #1-ranked model with native audio; no published per-second rate broken
// out yet, so anchored on the same INTERNATIONAL tier as Wan 2.7 (720P 20/s,
// 1080P 30/s) pending finance sign-off. DB-editable via the catalog ops flow.
export const HAPPYHORSE_VIDEO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'happyhorse-1-0-video-points-v1-2026-06-16',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720P',
  pointsPerSecond: { '720P': 20, '1080P': 30 },
  minSeconds: 2,
  maxSeconds: 15,
  defaultSeconds: 5,
  autoQuoteSeconds: 15,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// BytePlus ModelArk Seedance 2.0 is now co-bound onto the `seedance-2-0`
// canonical as the primary provider (see video-models.ts), so it shares the
// canonical SEEDANCE_2_0_PARAMETER_POLICY above — no BytePlus-specific policy.

/** Canonical `outputPolicy` factory. Output count follows product pricing. */
export function buildOutputPolicy(
  productPricing: AiProductPricingPolicy,
  outputType: 'image' | 'video' = 'image',
): Prisma.InputJsonObject {
  return {
    outputTypes: [outputType],
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
/** Queue name for video binding/canonical models (matches AI_QUEUE_VIDEO). */
export const VIDEO_QUEUE_NAME = 'ai-video-generation';

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
  overrides: {
    queueName?: string;
    globalConcurrency?: number;
    perUserRunning?: number;
    maxProviderRuntimeSeconds?: number;
  } = {},
): Prisma.InputJsonObject {
  const gated = Boolean(requiredPlan);
  return {
    queueName: overrides.queueName ?? IMAGE_QUEUE_NAME,
    globalConcurrency: overrides.globalConcurrency ?? 12,
    perUserRunning: overrides.perUserRunning ?? (gated ? 2 : 1),
    perUserQueued: gated ? 12 : 8,
    priority: gated ? 10 : 0,
    maxProviderRuntimeSeconds: overrides.maxProviderRuntimeSeconds ?? 600,
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
