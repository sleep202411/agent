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

/** Canonical compute-plan keys used by model gates. `null` = no plan gate. */
export type RequiredPlan = 'basic' | 'standard' | 'pro' | 'team' | null;

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
    max: 16,
    maskSupported: true,
  },
} as const satisfies Prisma.InputJsonObject;

/** fal queue OpenAPI: both GPT Image 2.5 variants share these controls. */
export const GPT_IMAGE_25_PARAMETER_POLICY = {
  ...GPT_IMAGE_2_PARAMETER_POLICY,
  promptMaxLength: 32000,
  defaultQuality: 'high',
  qualityOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
  // OpenAPI num_images maximum is 10; reference images have a separate cap of 16.
  variationOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  backgroundOptions: ['auto', 'transparent', 'opaque'],
  defaultBackground: 'auto',
} as const satisfies Prisma.InputJsonObject;

export const NANO_BANANA_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'nano-banana',
  // Shared Google Vertex + fal product control. The provider mappers translate
  // this canonical value to their respective imageConfig/aspect_ratio fields.
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
  defaultResolution: '1K',
  resolutionOptions: ['1K'],
  defaultOutputFormat: 'png',
  outputFormatOptions: ['png', 'jpeg'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 3,
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
    '9:21',
  ],
  advancedAspectRatios: ['1:4', '4:1', '1:8', '8:1'],
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '1K',
  resolutionOptions: ['512', '1K', '2K', '4K'],
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
    '9:21',
  ],
  advancedAspectRatios: ['1:4', '4:1', '1:8', '8:1'],
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '2K',
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
  replicateFallbackModel: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

export const NANO_BANANA_2_LITE_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'nano-banana',
  aspectParameter: 'aspect_ratio',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: [
    '1:1',
    '3:2',
    '2:3',
    '3:4',
    '4:3',
    '4:5',
    '5:4',
    '9:16',
    '16:9',
    '21:9',
  ],
  advancedAspectRatios: ['1:4', '4:1', '1:8', '8:1'],
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '1K',
  resolutionOptions: ['1K'],
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

export const QUICK_IMAGE_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'quick-image',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
  defaultVariations: 1,
  variationOptions: [1],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 1,
    maskSupported: false,
  },
  seed: { enabled: false },
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

export const SEEDREAM_5_PRO_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'seedream',
  defaultAspectRatio: '1:1',
  supportedAspectRatios: SEEDREAM_EXTENDED_ASPECT_RATIOS,
  defaultVariations: 1,
  variationOptions: [1],
  defaultResolution: '2K',
  // Official seedream-5-0-pro size levels: 1K / 2K only (no 3K/4K upstream).
  resolutionOptions: ['1K', '2K'],
  // Pro supports up to 10 reference images (lite/4.5/4.0 allow 14).
  referenceImages: SEEDREAM_REFERENCE_IMAGES,
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// v4 2026-09-17: global −30% (curated ladder — margins comfortably above 2×).
export const GPT_IMAGE_2_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'gpt-image-2-points-v4-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'medium',
  resolutionOptions: ['1K', '2K', '4K'],
  qualityOptions: ['low', 'medium', 'high'],
  matrix: {
    '1K': { low: 7, medium: 21, high: 42 },
    '2K': { low: 10.5, medium: 31.5, high: 63 },
    '4K': { low: 15.75, medium: 49, high: 98 },
  },
  referenceImageSurchargePoints: 7,
  extraReferenceImagePoints: 2.5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

/**
 * Curated selling prices, not a fixed upstream cost quote. Flare and Sunburst
 * share fal's token rates. Keep the launch prices independent of subsequent
 * Image 2 discounts; xhigh/max are priced at 2x/4x high.
 * v2 2026-09-17: global −30%; the xhigh=2×high / max=4×high curated ladder is
 * re-derived from the cut `high` tier so the structure survives the cut.
 */
export const GPT_IMAGE_25_PRODUCT_PRICING: AiProductPricingPolicy = {
  ...GPT_IMAGE_2_PRODUCT_PRICING,
  version: 'gpt-image-2.5-points-v2-2026-09-17',
  defaultQuality: 'high',
  maxOutputCount: 10,
  qualityOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
  matrix: {
    '1K': { low: 10, medium: 29, high: 59, xhigh: 118, max: 236 },
    '2K': { low: 15, medium: 44, high: 88, xhigh: 176, max: 352 },
    '4K': { low: 22, medium: 69, high: 137, xhigh: 274, max: 548 },
  },
};

// v2 2026-09-17: global −30% (7 pts ≈ 1.8× the $0.039/image Google cost).
// Note: Google deprecates 2.5 Flash Image on the Gemini API 2026-10-02.
export const NANO_BANANA_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'fixed_per_output',
  version: 'nano-banana-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  pointsPerOutput: 7,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v3 2026-09-17: global −30% (Google 3.1 flash image: $0.045/$0.067/$0.101/
// $0.151 per 512/1K/2K/4K → cut keeps ≈2.2×).
export const NANO_BANANA_2_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'nano-banana-2-points-v3-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['512', '1K', '2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '512': { standard: 10 },
    '1K': { standard: 14 },
    '2K': { standard: 21 },
    '4K': { standard: 35 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30% (7 pts ≈ 2.1× the $0.0336/image Google cost).
export const NANO_BANANA_2_LITE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'fixed_per_output',
  version: 'nano-banana-2-lite-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  pointsPerOutput: 7,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v3 2026-09-17: global −30% (Google 3 pro image: $0.134/1K-2K, $0.24/4K →
// cut keeps ≈2.6×).
export const NANO_BANANA_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'nano-banana-pro-points-v3-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 35 },
    '2K': { standard: 35 },
    '4K': { standard: 63 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%. ⚠️ Agnes per-image cost is not published —
// verify against an Agnes invoice before shipping if this lane matters.
export const QUICK_IMAGE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'fixed_per_output',
  version: 'quick-image-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  pointsPerOutput: 4,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const WAN_IMAGE_27_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'wan-image-2-7-pro-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 18 },
    '2K': { standard: 32 },
    '4K': { standard: 63 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const WAN_IMAGE_27_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'wan-image-2-7-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 8 },
    '2K': { standard: 14 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const QWEN_IMAGE_20_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'fixed_per_output',
  version: 'qwen-image-2-0-pro-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 6,
  pointsPerOutput: 25,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const QWEN_IMAGE_20_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'fixed_per_output',
  version: 'qwen-image-2-0-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 6,
  pointsPerOutput: 14,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const FLUX_2_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'flux-2-pro-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 21 },
    '2K': { standard: 49 },
  },
  referenceImageSurchargePoints: 7,
  extraReferenceImagePoints: 3.5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const HUNYUAN_WORLD_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'hunyuan-world-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 28 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const TOPAZ_UPSCALE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'topaz-upscale-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 10.5 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const BRIA_RMBG_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'bria-rmbg-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 7 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const ICLIGHT_RELIGHT_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'iclight-relight-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 14 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const QWEN_MULTI_ANGLE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'qwen-multi-angle-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 13 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const BRIA_EXPAND_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'bria-expand-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K'],
  qualityOptions: ['standard'],
  matrix: { '1K': { standard: 10.5 } },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v2 2026-09-17: global −30%.
export const FLUX_2_FLEX_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'flux-2-flex-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 35 },
    '2K': { standard: 84 },
  },
  referenceImageSurchargePoints: 10.5,
  extraReferenceImagePoints: 3.5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// Premium flux tier. Cost basis: fal $0.07 first MP + $0.03/extra MP
// (1K≈1MP=$0.07, 2K≈4MP=$0.16). Points keep the ~10x flux margin.
// v2 2026-09-17: global −30% (cut keeps ≈7× the fal cost basis).
export const FLUX_2_MAX_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'flux-2-max-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 49 },
    '2K': { standard: 112 },
  },
  referenceImageSurchargePoints: 10.5,
  extraReferenceImagePoints: 3.5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// Budget open-weight flux tier. Cost basis: $0.012/MP flat on both fal +
// replicate (1K≈$0.012, 2K≈4MP=$0.048). Up to 4 images/request on fal.
// v2 2026-09-17: global −30% (cut keeps ≈4.7×/5.8× the per-MP cost).
export const FLUX_2_DEV_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'flux-2-dev-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  matrix: {
    '1K': { standard: 8 },
    '2K': { standard: 28 },
  },
  referenceImageSurchargePoints: 3.5,
  extraReferenceImagePoints: 2,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const SEEDREAM_45_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  // v2 2026-07-08: re-based on official BytePlus per-piece cost ($0.040/piece,
  // flat across resolution) at a floored designed price (not raw ×margin).
  // v3 2026-09-17: global −30% (8 = 2.0× the $0.04/piece cost).
  version: 'seedream-4-5-points-v3-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['2K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '2K': { standard: 8 },
    '4K': { standard: 8 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

export const SEEDREAM_5_LITE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  // v2 2026-07-08: re-based on official BytePlus per-piece cost ($0.035/piece,
  // flat across resolution) at a floored designed price (10 = ~2.9× cost).
  // v3 2026-09-17: global −30% (7 = 2.0× cost).
  version: 'seedream-5-lite-points-v3-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['2K', '3K', '4K'],
  qualityOptions: ['standard'],
  matrix: {
    '2K': { standard: 7 },
    '3K': { standard: 7 },
    '4K': { standard: 7 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// Seedream 5.0 Pro — flagship. Official BytePlus cost (read 2026-09-17):
// $0.045/piece ≤2.61MP (1K) and $0.09/piece above (2K). Designed/floored pro
// price 15 — top of the seedream ladder (lite 10, 4.5 12, pro 15); capped,
// not raw ×margin.
// v2 2026-09-17: global −30% (10.5 flat = 2.3× the 1K cost, 1.17× the 2K
// cost — above the 1.10× floor at both tiers).
export const SEEDREAM_5_PRO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'seedream-5-pro-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  defaultQuality: 'standard',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['standard'],
  // Flat per-piece pricing (official bills per piece; see cost tiers above).
  matrix: {
    '1K': { standard: 10.5 },
    '2K': { standard: 10.5 },
  },
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// ── Seedance 2.5 / 2.0 (ByteDance video) ────────────────────────
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

const SEEDANCE_2_5_DURATION_OPTIONS = [
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
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
];

/**
 * Dreamina Seedance 2.5 (2026-06-28) — official BytePlus ModelArk contract.
 * Editing and extension are prompt-intent subtypes of multimodal reference,
 * not separate API modes. Declaring `omniReferenceTaskTypes` wires the
 * `omni_reference_task_type` guidance parameter (doc 1520757): the composer
 * gets a sub-mode selector, and edit/extend parameter locks are validated
 * pre-submit instead of failing asynchronously after task creation.
 */
export const SEEDANCE_2_5_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'seedance',
  promptMaxLength: 15_000,
  defaultResolution: '720p',
  resolutionOptions: ['480p', '720p', '1080p'],
  defaultDurationSeconds: '5',
  durationOptions: SEEDANCE_2_5_DURATION_OPTIONS,
  defaultAspectRatio: 'auto',
  supportedAspectRatios: SEEDANCE_2_0_ASPECT_RATIOS,
  defaultOutputFormat: 'mp4',
  outputFormatOptions: ['mp4', 'mov'],
  defaultOmniReferenceTaskType: 'auto',
  omniReferenceTaskTypes: ['auto', 'reference', 'edit', 'extend'],
  generateAudio: { enabled: true, default: true },
  startFrame: { enabled: true },
  endFrame: { enabled: true },
  referenceInputs: {
    enabled: true,
    images: {
      min: 0,
      max: 30,
      maxFileSizeMb: 30,
      acceptFormats: ['jpeg', 'png', 'webp'],
    },
    videos: {
      min: 0,
      max: 10,
      maxFileSizeMb: 200,
      minItemDurationSeconds: 2,
      maxItemDurationSeconds: 30,
      maxCombinedDurationSeconds: 30,
      acceptFormats: ['mp4', 'mov'],
      resolutionBand: '480p-720p',
    },
    audios: {
      min: 0,
      max: 10,
      maxFileSizeMb: 15,
      minItemDurationSeconds: 2,
      maxItemDurationSeconds: 30,
      maxCombinedDurationSeconds: 30,
      acceptFormats: ['mp3', 'wav'],
    },
    maxTotalFiles: 50,
    audioRequiresVisual: false,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

export const SEEDANCE_2_0_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'seedance',
  defaultResolution: '720p',
  // '4k' is the exact ModelArk enum literal (lowercase). Flagship-only lane:
  // upstream limits 4k to 15 RPM / concurrency 1, output is 10-bit HEVC.
  resolutionOptions: ['480p', '720p', '1080p', '4k'],
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
    images: {
      min: 0,
      max: 9,
      maxFileSizeMb: 30,
      acceptFormats: ['jpeg', 'png', 'webp'],
    },
    videos: {
      min: 0,
      max: 3,
      maxFileSizeMb: 50,
      maxCombinedFileSizeMb: 50,
      minItemDurationSeconds: 2,
      maxItemDurationSeconds: 15,
      maxCombinedDurationSeconds: 15,
      acceptFormats: ['mp4', 'mov'],
      resolutionBand: '480p-720p',
    },
    audios: {
      min: 0,
      max: 3,
      maxFileSizeMb: 15,
      maxItemDurationSeconds: 15,
      maxCombinedDurationSeconds: 15,
      acceptFormats: ['mp3', 'wav'],
    },
    maxTotalFiles: 12,
    audioRequiresVisual: true,
  },
  // ModelArk-verified (doc 1520757): the Seedance 2.0 series does NOT
  // support `seed` (1.x only) — the schema mappers gate on this flag.
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

export const QUICK_VIDEO_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'quick-video',
  defaultResolution: '480p',
  resolutionOptions: ['480p', '720p'],
  defaultDurationSeconds: '5',
  durationOptions: ['4', '5', '6', '8', '10', '12', '15'],
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  referenceImages: {
    enabled: true,
    min: 0,
    max: 1,
    maskSupported: false,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

/**
 * Google Veo 3.1 GA on Vertex AI. Standard supports native 4K and asset
 * references. Video extension is intentionally not exposed here: Vertex fixes
 * extension output at 7 seconds, which cannot share this generation policy's
 * 4/6/8-second control without presenting invalid combinations.
 */
export const VEO_3_1_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'veo',
  defaultResolution: '1080p',
  resolutionOptions: ['720p', '1080p', '4k'],
  defaultDurationSeconds: '8',
  durationOptions: ['4', '6', '8'],
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  generateAudio: { enabled: true, default: true },
  startFrame: { enabled: true },
  endFrame: { enabled: true },
  referenceImages: { enabled: true, min: 0, max: 3 },
  negativePrompt: { enabled: true },
  seed: { enabled: true },
} as const satisfies Prisma.InputJsonObject;

export const VEO_3_1_FAST_PARAMETER_POLICY = {
  ...VEO_3_1_PARAMETER_POLICY,
  defaultResolution: '1080p',
  resolutionOptions: ['720p', '1080p'],
} as const satisfies Prisma.InputJsonObject;

export const VEO_3_1_LITE_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'veo',
  defaultResolution: '720p',
  resolutionOptions: ['720p', '1080p'],
  defaultDurationSeconds: '8',
  durationOptions: ['4', '6', '8'],
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  generateAudio: { enabled: true, default: true },
  startFrame: { enabled: true },
  endFrame: { enabled: true },
  referenceImages: { enabled: false, min: 0, max: 0 },
  negativePrompt: { enabled: true },
  seed: { enabled: true },
} as const satisfies Prisma.InputJsonObject;

export const GEMINI_OMNI_FLASH_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'gemini-omni',
  defaultResolution: '720p',
  resolutionOptions: ['720p'],
  defaultDurationSeconds: '8',
  durationOptions: ['3', '4', '5', '6', '7', '8', '9', '10'],
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  startFrame: { enabled: true },
  referenceImages: { enabled: true, min: 0, max: 10 },
  sourceVideo: { enabled: true, maxFileSizeMb: 50 },
  nativeAudio: { enabled: true, alwaysOn: true },
  seed: { enabled: false },
  negativePrompt: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// Public list price: $0.40/s with audio (720p/1080p) and $0.60/s at 4k;
// video-only is $0.20/s and $0.30/s (Google, 2026-09-16). The 2026-09-17
// global −30% reprice floors every tier at ≥1.10× cost, so the standard tier
// lands at 44/66 (1.10×) rather than the raw ×0.7 (42/63 = 1.05×).
export const VEO_3_1_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'veo-3-1-points-v3-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1080p',
  pointsPerSecond: { '720p': 44, '1080p': 44, '4k': 66 },
  videoOnlyPointsPerSecond: { '720p': 22, '1080p': 22, '4k': 42 },
  minSeconds: 4,
  maxSeconds: 8,
  defaultSeconds: 8,
  autoQuoteSeconds: 8,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// Public list price: $0.10/s at 720p and $0.12/s at 1080p with audio;
// video-only is $0.08/s and $0.10/s respectively (Google, 2026-09-16).
// −30% 2026-09-17: 720p floors at 11 (1.10× cost) instead of the raw 11.2.
export const VEO_3_1_FAST_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'veo-3-1-fast-points-v3-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '1080p',
  pointsPerSecond: { '720p': 11, '1080p': 14 },
  videoOnlyPointsPerSecond: { '720p': 8, '1080p': 10.5 },
  minSeconds: 4,
  maxSeconds: 8,
  defaultSeconds: 8,
  autoQuoteSeconds: 8,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// List price $0.05/s (720p) and $0.08/s (1080p) with audio (Google,
// 2026-09-16). −30% 2026-09-17: 1080p floors at 9 (1.13×) — the raw ×0.7
// (8.4→8) would sit exactly at cost.
export const VEO_3_1_LITE_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'veo-3-1-lite-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '720p': 6, '1080p': 9 },
  videoOnlyPointsPerSecond: { '720p': 4, '1080p': 6 },
  minSeconds: 4,
  maxSeconds: 8,
  defaultSeconds: 8,
  autoQuoteSeconds: 8,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// Omni Flash video output ≈$0.10/s (5,792 tokens/s × $17.50/M output video
// tokens, Google 2026-09-16). −30% 2026-09-17: floors at 12 (1.19×) — the raw
// ×0.7 (11.2→11) would be 1.09×.
export const GEMINI_OMNI_FLASH_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'gemini-omni-flash-preview-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '720p': 12 },
  minSeconds: 3,
  maxSeconds: 10,
  defaultSeconds: 8,
  autoQuoteSeconds: 10,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v3 2026-07-08: re-based on the OFFICIAL BytePlus ModelArk per-second cost
// (720p ≈ $0.151/s, 480p ≈ $0.067/s) — fal (retired) was ~2× pricier, so the old
// v2 points (61/37) were an accidental ~4× margin. Designed/floored price, not
// raw ×margin: 720p 25 (~1.65×), 480p 12 (floored ≥ double digit).
// v5 2026-07-12: 4k enabled — upstream replaced the launch-era 2K ceiling with
// native 4K (June 2026); official enum is 480p/720p/1080p/4k.
// v6 2026-09-17: global −30% with a ≥1.10× cost floor (BytePlus pricing page,
// read 2026-09-17: 480p $0.07/s, 720p $0.15/s, 1080p $0.37/s, 4k $0.78/s —
// the 4k figure corrects the old "$1.36/s" note, which over-counted tokens:
// 4K 16:9 is 194,400 tokens/s × $4.0/M = $0.778/s). 1080p floors at 41 (1.11×);
// raw ×0.7 (31.5) would have inverted against the $0.37/s cost.
export const SEEDANCE_2_0_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'seedance-2-0-points-v6-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '480p': 8, '720p': 18, '1080p': 41, '4k': 126 },
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

// Official Seedance 2.5 list pricing (2026-08-07): without video input,
// 480p ≈ $0.103/s and 720p ≈ $0.231/s. With video input, ModelArk bills
// (combined input-video seconds + output seconds) at ≈$0.062/$0.139 per
// second. Product points keep the established ~1.65× Seedance ladder while
// charging the correct meter for reference-video jobs.
// v3 2026-09-17: global −30% with a ≥1.10× cost floor. Costs verified against
// the BytePlus pricing page (read 2026-09-17): no-video 480p $0.103/s, 720p
// $0.231/s, 1080p $0.569/s list ($0.41/s launch promo ended 2026-09-17);
// with-video meter ≈$0.062/$0.139/$0.34 per combined second. All tiers clear
// the floor on the raw ×0.7 — including 1080p (90 = 1.58× list cost), so the
// 2026-09-05 1080p promo-window headroom now covers the cut.
export const SEEDANCE_2_5_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'seedance-2-5-points-v3-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  // v2 2026-09-05: 1080p tier added. BytePlus 1080p costs ≈$0.41/s (promo,
  // ends 2026-09-17; list ≈$0.57/s) vs 720p $0.121-0.139/s — priced at the
  // same design margin as the 720p tier (128 ≈ 38 × 3.4×). Note: 1080p
  // output is 10-bit H.265/HEVC (doc 1520757 playback-compat warning).
  pointsPerSecond: { '480p': 13, '720p': 27, '1080p': 90 },
  referenceVideoPointsPerSecond: { '480p': 8, '720p': 16, '1080p': 55 },
  minSeconds: 4,
  maxSeconds: 30,
  defaultSeconds: 5,
  autoQuoteSeconds: 30,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

// v3 2026-07-08: official BytePlus cost 720p ≈ $0.121/s, 480p ≈ $0.054/s.
// Designed/floored: 720p 20 (~1.65×), 480p 10.
// v4 2026-09-17: global −30% (7/14 = 1.17×/1.17× the $0.06/$0.12/s cost).
export const SEEDANCE_2_0_FAST_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'seedance-2-0-fast-points-v4-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '480p': 7, '720p': 14 },
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

// Seedance 2.0 mini — official budget tier (~50% cheaper than 2.0). Cost 720p
// ≈ $0.076/s ($0.0035/K exclude-video), 480p ≈ $0.034/s. Designed/floored:
// 720p 12, 480p 8. 480p/720p only (no 1080p/4k upstream).
// v2 2026-09-17: global −30% with a ≥1.10× cost floor — 720p floors at 9
// (1.18×) because the raw ×0.7 (8.4→8) would be 1.05× the $0.076/s cost.
export const SEEDANCE_2_0_MINI_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'seedance-2-0-mini-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '480p': 6, '720p': 9 },
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

// Fast + mini support 480p/720p only — a shared param policy so the flagship's
// 1080p option never leaks into the non-flagship variants.
export const SEEDANCE_2_0_SD_PARAMETER_POLICY = {
  ...SEEDANCE_2_0_PARAMETER_POLICY,
  resolutionOptions: ['480p', '720p'],
} as const;

/**
 * MiniMax-H3 video — V2 content[] API.
 * User-facing enums match the official OpenAPI wire values (not Seedance
 * aliases): resolution 768P|2K; ratio adaptive|21:9|… (no "auto").
 * Official list (paygo): 768P $0.08/s · 2K $0.13/s. Designed points ≈1.5–1.9×
 * (1 pt = $0.01): 768P 12 / 2K 25 → ~33% / ~48% gross on output-only jobs.
 *
 * Ratio rules (mapper enforces): t2v requires a concrete ratio (default 16:9);
 * i2v forces adaptive; r2v defaults adaptive when adaptive is selected.
 */
export const MINIMAX_H3_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'minimax-h3',
  defaultResolution: '2K',
  resolutionOptions: ['768P', '2K'],
  defaultDurationSeconds: '5',
  durationOptions: [
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
  ],
  // Official enum includes adaptive; default concrete for t2v (required).
  defaultAspectRatio: '16:9',
  supportedAspectRatios: [
    '16:9',
    '9:16',
    '1:1',
    '4:3',
    '3:4',
    '21:9',
    'adaptive',
  ],
  generateAudio: { enabled: false, default: false },
  startFrame: { enabled: true },
  endFrame: { enabled: true },
  referenceInputs: {
    enabled: true,
    images: { min: 0, max: 9 },
    videos: { min: 0, max: 3 },
    audios: { min: 0, max: 3 },
    maxTotalFiles: 12,
  },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// v3 2026-09-17: global −30% with a ≥1.10× cost floor — 768P floors at 9
// (1.13×) because the raw ×0.7 (8.4→8) would sit exactly at the $0.08/s cost.
export const MINIMAX_H3_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'minimax-h3-points-v3-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '2K',
  // Keys match official resolution enum (and UI).
  pointsPerSecond: { '768P': 9, '2K': 18 },
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

// v2 2026-09-17: global −30%. ⚠️ Agnes per-second cost is not published —
// verify against an Agnes invoice before shipping if this lane matters.
export const QUICK_VIDEO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'quick-video-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '480p',
  pointsPerSecond: { '480p': 4, '720p': 6 },
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
// Kling v1 standard image-to-video — the ONLY Kling tier with the motion brush
// (dynamic masks: a painted region + a trajectory of points, + an optional
// static mask). Lower quality than v2.1 but the trajectory control is the
// point. Source image → image_url (start frame); duration 5/10 s; required
// prompt. The studio Motion editor produces dynamic_masks (emitted by the
// mapper's motionBrush branch). No resolution/aspect knobs on this endpoint.
export const KLING_MOTION_PARAMETER_POLICY = {
  parameterMode: 'provider_intersection',
  providerFamily: 'kling',
  defaultDurationSeconds: '5',
  durationOptions: ['5', '10'],
  startFrame: { enabled: true },
  motionBrush: { enabled: true },
  seed: { enabled: false },
} as const satisfies Prisma.InputJsonObject;

// Kling v1 standard i2v — per-second points. ESTIMATE anchored on fal's Kling
// standard tier (~$0.06/s) at a 2.0× margin → ~12 pts/s; no resolution param,
// so a single nominal key. DB-editable via the catalog ops flow.
// v2 2026-09-17: global −30% → 8 pts/s (~1.33× the estimated cost).
export const KLING_MOTION_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'kling-v1-motion-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '720p': 8 },
  minSeconds: 5,
  maxSeconds: 10,
  defaultSeconds: 5,
  autoQuoteSeconds: 10,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

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
// v2 2026-09-17: global −30% → 14/21 pts/s (1.4× the estimated cost anchor).
export const WAN_2_7_VIDEO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'wan-2-7-video-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720P',
  pointsPerSecond: { '720P': 14, '1080P': 21 },
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

/**
 * Wan 3.0's single all-in-one endpoint serves text, first/last frame, and
 * mixed reference media. The policy mirrors the official 2026-08-06 API:
 * 480P/720P/1080P, adaptive or fixed ratios, 2-30 second output, native audio,
 * and up to 10 images / 5 videos / 5 audio clips as references.
 */
export const WAN_3_0_VIDEO_PARAMETER_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'wan',
  providerProtocol: 'wan3-video',
  maxPromptCharacters: 20_000,
  defaultResolution: '720P',
  resolutionOptions: ['480P', '720P', '1080P'],
  defaultDurationSeconds: 5,
  minDurationSeconds: 2,
  maxDurationSeconds: 30,
  defaultAspectRatio: 'adaptive',
  supportedAspectRatios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
  // Wan 3.0 accepts ratio for every mode; Wan 2.7 only accepts it for T2V.
  aspectRatioStrategy: 'always',
  startFrame: { enabled: true },
  endFrame: { enabled: true },
  referenceTypes: [
    'reference_image',
    'reference_video',
    'reference_audio',
    'file',
    'link',
  ],
  maxReferenceItems: 20,
  referenceLimits: {
    reference_image: 10,
    reference_video: 5,
    reference_audio: 5,
    file: 1,
    link: 1,
  },
  referenceVoice: { enabled: false },
  generateAudio: { enabled: true, default: true },
  enableThinking: { enabled: true, default: false },
  promptExtend: { enabled: false },
  watermark: { enabled: true, default: false },
  seed: { enabled: true, minimum: 0, maximum: 2147483647 },
} as const satisfies Prisma.InputJsonObject;

// International list price is $0.05/$0.10/$0.20 per second for
// 480P/720P/1080P. Product points keep the catalog's 2× gross-margin policy
// (1 compute point ≈ US$0.01). Provider-cost accounting remains the exact list
// price and is stored separately on the binding snapshot.
// v2 2026-09-17: global −30% → 7/14/28 pts/s (1.4× the international list).
export const WAN_3_0_VIDEO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'wan-3-0-video-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720P',
  pointsPerSecond: { '480P': 7, '720P': 14, '1080P': 28 },
  minSeconds: 2,
  maxSeconds: 30,
  defaultSeconds: 5,
  autoQuoteSeconds: 30,
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
  // Expose typed image inputs through the shared reference/compiler pipeline.
  // Retain the existing qualified four-reference catalog ceiling.
  maxReferenceItems: 4,
  referenceLimits: { reference_image: 4 },
  referenceVoice: { enabled: false },
  aspectRatioStrategy: 'always',
  promptExtend: { enabled: true },
  seed: { enabled: true, minimum: 0, maximum: 2147483647 },
} as const satisfies Prisma.InputJsonObject;

// HappyHorse 1.0 — per-second points (积分 ≡ US cent). ESTIMATE: HappyHorse is a
// premium #1-ranked model with native audio; no published per-second rate broken
// out yet, so anchored on the same INTERNATIONAL tier as Wan 2.7 (720P 20/s,
// 1080P 30/s) pending finance sign-off. DB-editable via the catalog ops flow.
// v2 2026-09-17: global −30% → 14/21 pts/s (1.4× the estimated anchor).
export const HAPPYHORSE_VIDEO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'happyhorse-1-0-video-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720P',
  pointsPerSecond: { '720P': 14, '1080P': 21 },
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

// HappyHorse 1.1 — upgrade of 1.0 (stronger motion, higher consistency,
// multi-image reference). Same Model Studio video-synthesis contract + param
// surface as 1.0, so this is a faithful clone. ⚠️ Confirm the 1.1 upstream model
// ids + exact param set (duration floor, ratio set) against a LIVE DashScope
// probe before deploying — 1.0 was live-probed 2026-06-16; 1.1 is documented
// here but NOT yet probed.
export const HAPPYHORSE_1_1_VIDEO_PARAMETER_POLICY = {
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
  referenceTypes: ['reference_image'], // r2v: reference_image only
  promptExtend: { enabled: true },
  seed: { enabled: true, minimum: 0, maximum: 2147483647 },
} as const satisfies Prisma.InputJsonObject;

// HappyHorse 1.1 — per-second points (积分 ≡ US cent). Premium tier; same anchor
// as 1.0 / Wan 2.7 (720P 20/s, 1080P 30/s = ~2× a standard video tier, i.e. it
// draws 2× from the free allowance) pending finance sign-off. DB-editable via the
// catalog ops flow.
// v2 2026-09-17: global −30% → 14/21 pts/s (1.4× the estimated anchor).
export const HAPPYHORSE_1_1_VIDEO_PRODUCT_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'happyhorse-1-1-video-points-v2-2026-09-17',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720P',
  pointsPerSecond: { '720P': 14, '1080P': 21 },
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
  outputType: 'image' | 'video' | 'audio' = 'image',
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
/** Queue name for audio binding/canonical models (matches AI_QUEUE_AUDIO). */
export const AUDIO_QUEUE_NAME = 'ai-audio-generation';

/**
 * `entitlementPolicy` factory — only the canonical compute `requiredPlan`
 * varies. Provider selection is an internal routing concern.
 */
export function buildEntitlementPolicy(
  requiredPlan: RequiredPlan,
): Prisma.InputJsonObject {
  return {
    requiredPlan,
    freeUserVisible: true,
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
 * `queuePolicy` factory — how much of a model one user may occupy, and how much
 * of it exists at all. Every number here is a CAPACITY statement about the
 * provider, deliberately independent of `requiredPlan`.
 *
 * It did not used to be: the caps were `gated ? 2 : 1` off the model's plan
 * gate, which welded two unrelated decisions together — opening a model to
 * everyone silently halved its concurrency, and widening its concurrency
 * silently put it behind a paid plan.
 *
 * The user's own plan is the other half of the limit and is applied at request
 * time: `routing.service.ts` takes `min(entitlement.limits.concurrentJobs,
 * queuePolicy.perUserRunning)`. So these values are a ceiling that protects the
 * shared pool, not the product's idea of what a paying customer deserves — set
 * them from provider capacity, and let the plan decide the rest. Set them too
 * low and no plan upgrade can be felt: at perUserRunning 1, `team`'s 28
 * concurrent jobs bought the customer exactly nothing.
 */
export function buildQueuePolicy(
  overrides: {
    queueName?: string;
    globalConcurrency?: number;
    perUserRunning?: number;
    perUserQueued?: number;
    maxProviderRuntimeSeconds?: number;
  } = {},
): Prisma.InputJsonObject {
  return {
    queueName: overrides.queueName ?? IMAGE_QUEUE_NAME,
    // Image defaults. 5,689 jobs of history peaked at 4 concurrent platform-wide
    // and exactly 2 per user — i.e. the old per-user cap of 2 was the binding
    // constraint, not demand. 6 of a 12-wide pool leaves room for two users at
    // full tilt; images are seconds long and cheap.
    globalConcurrency: overrides.globalConcurrency ?? 12,
    perUserRunning: overrides.perUserRunning ?? 6,
    perUserQueued: overrides.perUserQueued ?? 12,
    // Read by nothing today (no consumer of queuePolicy.priority exists in
    // apps/server). Kept as a constant so the stored shape stays stable rather
    // than gaining and losing a key; do not reintroduce a derived value here.
    priority: 0,
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
    defaultMode: 'simple',
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
