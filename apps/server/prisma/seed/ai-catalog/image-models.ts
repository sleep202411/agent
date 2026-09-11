/**
 * Declarative catalog of canonical AI image models.
 *
 * One clean entry per canonical model — NO policy boilerplate here (that lives
 * in `defaults.ts` and is merged by `seed-catalog.ts`). The `providers` array
 * lists ONLY provider entries that map to a reconciled `AiProviderAccount`
 * (active: `fal-ai`, `aliyun-bailian`, `byteplus-modelark`, `google-vertex`,
 * `agnes-ai`, `minimax`). Each entry seeds an `AiProviderEndpoint` + a runtime-valid
 * `AiProviderModelBinding`. A model whose only upstream providers have no
 * reconciled account carries `providers: []` and is seeded as
 * canonical-only (no binding — valid, just can't generate yet).
 *
 * Every entry below is a reviewed product-facing ContainerModel. Provider
 * endpoints stay implementation details; user-visible controls and pricing are
 * defined at the canonical model layer.
 */
import {
  GPT_IMAGE_25_EDIT_SCHEMA,
  GPT_IMAGE_25_TEXT_SCHEMA,
  GPT_IMAGE_25_OUTPUT_SCHEMA,
} from './gpt-image-25.schemas';
import type { Prisma } from '@prisma/client';
import type { AiGenerationMode, AiProductPricingPolicy } from '@repo/shared';

import {
  FLUX_2_DEV_PARAMETER_POLICY,
  FLUX_2_DEV_PRODUCT_PRICING,
  FLUX_2_FLEX_PARAMETER_POLICY,
  FLUX_2_FLEX_PRODUCT_PRICING,
  FLUX_2_MAX_PARAMETER_POLICY,
  FLUX_2_MAX_PRODUCT_PRICING,
  FLUX_2_PRO_PARAMETER_POLICY,
  FLUX_2_PRO_PRODUCT_PRICING,
  GPT_IMAGE_25_PARAMETER_POLICY,
  GPT_IMAGE_25_PRODUCT_PRICING,
  GPT_IMAGE_2_PARAMETER_POLICY,
  GPT_IMAGE_2_PRODUCT_PRICING,
  HUNYUAN_WORLD_PARAMETER_POLICY,
  HUNYUAN_WORLD_PRODUCT_PRICING,
  NANO_BANANA_2_PARAMETER_POLICY,
  NANO_BANANA_2_PRODUCT_PRICING,
  NANO_BANANA_2_LITE_PARAMETER_POLICY,
  NANO_BANANA_2_LITE_PRODUCT_PRICING,
  NANO_BANANA_PARAMETER_POLICY,
  NANO_BANANA_PRODUCT_PRICING,
  NANO_BANANA_PRO_PARAMETER_POLICY,
  NANO_BANANA_PRO_PRODUCT_PRICING,
  QWEN_IMAGE_20_PARAMETER_POLICY,
  QWEN_IMAGE_20_PRODUCT_PRICING,
  QWEN_IMAGE_20_PRO_PARAMETER_POLICY,
  QWEN_IMAGE_20_PRO_PRODUCT_PRICING,
  QUICK_IMAGE_PARAMETER_POLICY,
  QUICK_IMAGE_PRODUCT_PRICING,
  SEEDREAM_45_PARAMETER_POLICY,
  SEEDREAM_45_PRODUCT_PRICING,
  SEEDREAM_5_LITE_PARAMETER_POLICY,
  SEEDREAM_5_LITE_PRODUCT_PRICING,
  SEEDREAM_5_PRO_PARAMETER_POLICY,
  SEEDREAM_5_PRO_PRODUCT_PRICING,
  BRIA_EXPAND_PARAMETER_POLICY,
  BRIA_EXPAND_PRODUCT_PRICING,
  BRIA_RMBG_PARAMETER_POLICY,
  BRIA_RMBG_PRODUCT_PRICING,
  ICLIGHT_RELIGHT_PARAMETER_POLICY,
  ICLIGHT_RELIGHT_PRODUCT_PRICING,
  QWEN_MULTI_ANGLE_PARAMETER_POLICY,
  QWEN_MULTI_ANGLE_PRODUCT_PRICING,
  TOPAZ_UPSCALE_PARAMETER_POLICY,
  TOPAZ_UPSCALE_PRODUCT_PRICING,
  WAN_IMAGE_27_PARAMETER_POLICY,
  WAN_IMAGE_27_PRODUCT_PRICING,
  WAN_IMAGE_27_PRO_PARAMETER_POLICY,
  WAN_IMAGE_27_PRO_PRODUCT_PRICING,
  type RequiredPlan,
} from './defaults';

/**
 * Provider keys allowed on seed bindings.
 * Must match active generation providers (`AI_PROVIDER_KEYS` in @repo/shared).
 */
export type ProviderKey =
  | 'fal-ai'
  | 'byteplus-modelark'
  | 'byteplus-seed-speech'
  | 'aliyun-bailian'
  | 'google-vertex'
  | 'agnes-ai'
  | 'minimax';

/**
 * A provider that backs a canonical model and HAS a reconciled account.
 * `endpointId` is the provider-native endpoint slug (e.g. the fal model path);
 * `provider` filters runtime routing, so it is the account key, never an alias
 * prefix.
 */
export interface ProviderEntry {
  provider: ProviderKey;
  /** Provider-native endpoint id (fal model path, etc.). Runtime calls this. */
  endpointId: string;
  /** Provider-supported modes when narrower than the ContainerModel union. */
  modes?: AiGenerationMode[];
  /** Route priority (lower = preferred). Defaults to 100 if omitted. */
  priority?: number;
  /** Route weight (higher = preferred within a priority). Defaults to 100. */
  weight?: number;
  /** Optional endpoint-level display name when it differs from ContainerModel. */
  displayName?: string;
  /** Provider-native request contract snapshot. Runtime still owns mapping. */
  providerInputSchema?: Prisma.InputJsonObject;
  /** Provider-native output contract snapshot. */
  providerOutputSchema?: Prisma.InputJsonObject;
  /** Provider docs/pricing/call-mode snapshot captured at seed time. */
  catalogSnapshot?: Prisma.InputJsonObject;
  maxConcurrentRequests?: number;
  maxRequestsPerMinute?: number;
  requestTimeoutSeconds?: number;
  cooldownSeconds?: number;
  failureThreshold?: number;
}

/** One declarative canonical image-model entry. */
export interface ImageModelSeed {
  slug: string;
  displayName: string;
  family: string;
  /**
   * The company that makes the model (ByteDance / Google / Black Forest Labs /
   * Alibaba / OpenAI / …). Surfaced to the UI as the "Providers" filter axis.
   * Distinct from the routing `providers[]` (fal-ai / byteplus-modelark / …),
   * which is the API channel, not the vendor a user recognises.
   */
  vendor: string;
  description: string;
  modes: AiGenerationMode[];
  /**
   * Lowest plan allowed to CALL this model, or `null` for open to everyone.
   * The check is rank-based, so 'basic' admits basic and everything above it.
   *
   * Required, and deliberately not optional: adding a model is exactly the
   * moment to decide who may run it, and an omitted gate reads the same as a
   * forgotten one.
   *
   * Says nothing about concurrency — that lives in `queuePolicy` and is a
   * statement about provider capacity. The two shared one field until a plan
   * rename ('vip' → 'basic') travelled down the entitlement path and paywalled
   * all 32 models at once; locked models are not rendered as locked, so the
   * whole catalogue simply disappeared from every picker.
   */
  requiredPlan: RequiredPlan;
  /** Default preflight cost in compute points. */
  cost: number;
  /** User-facing parameter contract for this ContainerModel. */
  parameterPolicy: Prisma.InputJsonObject;
  /** User-facing product pricing; every ContainerModel must define this. */
  productPricing: AiProductPricingPolicy;
  /** UI display group. */
  group: string;
  /** UI sort order within the catalog. */
  sortOrder: number;
  /** UI "recommended" badge. Defaults to false. */
  recommended?: boolean;
  /** Account-backed providers to bind. Empty = canonical-only (no binding). */
  providers: ProviderEntry[];
  /** Original alias strings, kept for metadata provenance only. */
  providerAliases: string[];
}

const T2I: AiGenerationMode = 'text_to_image';
const I2I: AiGenerationMode = 'image_to_image';
const INPAINT: AiGenerationMode = 'inpainting';
const UPSCALE: AiGenerationMode = 'upscale';
const REMOVE_BG: AiGenerationMode = 'remove_background';
const RELIGHT: AiGenerationMode = 'relight';
const MULTI_ANGLE: AiGenerationMode = 'multi_angle';
const OUTPAINT: AiGenerationMode = 'outpainting';

const PROVIDER_IMAGE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          mimeType: { type: 'string' },
        },
      },
    },
  },
} as const satisfies Prisma.InputJsonObject;

const GOOGLE_GEMINI_IMAGE_INPUT_SCHEMA = {
  type: 'object',
  required: ['model', 'contents', 'config'],
  properties: {
    model: { type: 'string' },
    contents: { type: 'array' },
    config: {
      type: 'object',
      properties: {
        responseModalities: { type: 'array', items: { type: 'string' } },
        imageConfig: {
          type: 'object',
          properties: {
            aspectRatio: { type: 'string' },
            imageSize: { type: 'string' },
            outputMimeType: { type: 'string' },
          },
        },
      },
    },
  },
} as const satisfies Prisma.InputJsonObject;

const GOOGLE_GEMINI_IMAGE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: {
            type: 'object',
            properties: { parts: { type: 'array' } },
          },
          finishReason: { type: 'string' },
        },
      },
    },
    responseId: { type: 'string' },
    usageMetadata: { type: 'object' },
  },
} as const satisfies Prisma.InputJsonObject;

function googleGeminiImageSnapshot(model: string): Prisma.InputJsonObject {
  const modelCards: Record<string, string> = {
    'gemini-2.5-flash-image':
      'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-image',
    'gemini-3.1-flash-lite-image':
      'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite-image',
    'gemini-3.1-flash-image':
      'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-image',
    'gemini-3-pro-image':
      'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-pro-image',
  };
  const modelCard = modelCards[model];
  if (!modelCard) {
    throw new Error(`Missing official Google image model card for ${model}.`);
  }
  const lifecycle: Record<string, string> =
    model === 'gemini-2.5-flash-image'
      ? {
          stage: 'ga',
          releasedAt: '2025-10-02',
          retirementAt: '2026-10-02',
        }
      : model === 'gemini-3.1-flash-lite-image'
        ? { stage: 'ga', releasedAt: '2026-06-30' }
        : {
            stage: 'ga',
            releasedAt: '2026-05-28',
            retirementNotBefore: '2027-05-28',
          };
  return {
    service: 'Vertex AI generateContent',
    model,
    apiVersion: 'v1',
    authentication: 'Application Default Credentials',
    callMode: 'sync',
    lifecycle,
    docs: [
      {
        title: `${model} model card`,
        url: modelCard,
      },
      {
        title: 'Generate images with Gemini',
        url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/image-generation',
      },
      {
        title: 'Google Gen AI SDK for JavaScript',
        url: 'https://googleapis.github.io/js-genai/',
      },
    ],
    pricing: {
      source: 'provider_usage',
      unit: 'input_and_output_tokens',
      url: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
    },
  };
}

const BAILIAN_MULTIMODAL_INPUT_SCHEMA = {
  type: 'object',
  required: ['model', 'input'],
  properties: {
    model: { type: 'string' },
    input: {
      type: 'object',
      properties: {
        messages: { type: 'array' },
      },
    },
    parameters: {
      type: 'object',
      properties: {
        size: { type: 'string' },
        n: { type: 'integer' },
        seed: { type: 'integer' },
        watermark: { type: 'boolean' },
      },
    },
  },
} as const satisfies Prisma.InputJsonObject;

const FAL_QWEN_INPUT_SCHEMA = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string' },
    negative_prompt: { type: 'string' },
    image_size: { type: ['string', 'object'] },
    num_images: { type: 'integer' },
    output_format: { type: 'string' },
    seed: { type: 'integer' },
  },
} as const satisfies Prisma.InputJsonObject;

const FAL_FLUX_INPUT_SCHEMA = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string' },
    image_size: { type: ['string', 'object'] },
    image_urls: { type: 'array', items: { type: 'string' } },
    seed: { type: 'integer' },
    safety_tolerance: { type: 'integer' },
    enable_safety_checker: { type: 'boolean' },
    output_format: { type: 'string' },
    sync_mode: { type: 'boolean' },
  },
} as const satisfies Prisma.InputJsonObject;

const FAL_FLUX_FLEX_INPUT_SCHEMA = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string' },
    image_size: { type: ['string', 'object'] },
    image_urls: { type: 'array', items: { type: 'string' } },
    seed: { type: 'integer' },
    safety_tolerance: { type: 'integer' },
    enable_safety_checker: { type: 'boolean' },
    output_format: { type: 'string' },
    sync_mode: { type: 'boolean' },
    guidance_scale: { type: 'number' },
    num_inference_steps: { type: 'integer' },
  },
} as const satisfies Prisma.InputJsonObject;

function bailianCatalogSnapshot(args: {
  model: string;
  callMode: 'sync' | 'async';
  cnRmbPerImage: number;
  globalRmbPerImage: number;
  docsUrl: string;
}): Prisma.InputJsonObject {
  return {
    service: 'multimodal-generation',
    callMode: args.callMode,
    pricing: {
      source: 'aliyun_model_studio_official_pricing',
      unit: 'image',
      currency: 'CNY',
      unitPriceByMarket: {
        cn: args.cnRmbPerImage,
        global: args.globalRmbPerImage,
      },
      defaultMarket: 'global',
      defaultUnitPrice: args.globalRmbPerImage,
    },
    docs: [{ title: 'Alibaba Model Studio API reference', url: args.docsUrl }],
    model: args.model,
  };
}

/**
 * Bailian VIDEO binding snapshot — routes the runtime to the async DashScope
 * video-synthesis service (`service: 'video-synthesis'`, `callMode: 'async'`),
 * unlike the image helper which targets multimodal-generation. Pricing here is
 * provider-cost tracking (per second), separate from the user-facing
 * productPricing on the canonical.
 */
export function bailianVideoCatalogSnapshot(args: {
  model: string;
  cnRmbPerSecond: number;
  globalRmbPerSecond: number;
  docsUrl: string;
}): Prisma.InputJsonObject {
  return {
    service: 'video-synthesis',
    callMode: 'async',
    pricing: {
      source: 'aliyun_model_studio_official_pricing',
      unit: 'second',
      currency: 'CNY',
      unitPriceByMarket: {
        cn: args.cnRmbPerSecond,
        global: args.globalRmbPerSecond,
      },
      defaultMarket: 'global',
      defaultUnitPrice: args.globalRmbPerSecond,
    },
    docs: [{ title: 'Alibaba Model Studio API reference', url: args.docsUrl }],
    model: args.model,
  };
}

function falCatalogSnapshot(args: {
  model: string;
  usdPerImage?: number;
  usdPerUnit?: number;
  unit?: string;
  pricingSource?: string;
  pricingNote?: string;
  docsUrl: string;
}): Prisma.InputJsonObject {
  return {
    pricing: {
      source: args.pricingSource ?? 'fal_public_pricing',
      unit: args.unit ?? 'image',
      currency: 'USD',
      unitPrice: args.usdPerUnit ?? args.usdPerImage,
      ...(args.pricingNote ? { note: args.pricingNote } : {}),
    },
    docs: [{ title: 'fal.ai model', url: args.docsUrl }],
    model: args.model,
  };
}

export const IMAGE_MODELS: ImageModelSeed[] = [
  {
    slug: 'gpt-image-2',
    displayName: 'GPT Image 2',
    family: 'gpt-image',
    vendor: 'OpenAI',
    description:
      'OpenAI image generation and editing model for instruction-following, typography, layout, product mockups, and structured visual edits.',
    modes: [T2I, I2I, INPAINT],
    requiredPlan: null,
    cost: 30,
    parameterPolicy: GPT_IMAGE_2_PARAMETER_POLICY,
    productPricing: GPT_IMAGE_2_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 10,
    recommended: true,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'openai/gpt-image-2',
        priority: 10,
        weight: 100,
      },
    ],
    providerAliases: ['fal/openai/gpt-image-2'],
  },
  ...(['flare', 'sunburst'] as const).map(
    (variant, index): ImageModelSeed => ({
      slug: `gpt-image-2.5-${variant}`,
      displayName: `GPT Image 2.5 ${variant === 'flare' ? 'Flare' : 'Sunburst'}`,
      family: 'gpt-image',
      vendor: 'OpenAI',
      description:
        variant === 'flare'
          ? 'Fast image generation and editing with up to 16 reference images.'
          : 'Precision image generation and editing for detailed compositions with up to 16 reference images.',
      modes: [T2I, I2I, INPAINT],
      requiredPlan: null,
      cost: 84,
      parameterPolicy: GPT_IMAGE_25_PARAMETER_POLICY,
      productPricing: GPT_IMAGE_25_PRODUCT_PRICING,
      group: 'recommended',
      sortOrder: 11 + index,
      recommended: true,
      providers: (['text-to-image', 'edit'] as const).map(
        (operation, endpointIndex) => ({
          provider: 'fal-ai',
          endpointId: `openai/gpt-image-2.5/${variant}/${operation}`,
          modes: operation === 'edit' ? [I2I, INPAINT] : [T2I],
          priority: 10 + endpointIndex,
          weight: 100,
          providerInputSchema:
            operation === 'edit'
              ? GPT_IMAGE_25_EDIT_SCHEMA
              : GPT_IMAGE_25_TEXT_SCHEMA,
          providerOutputSchema: GPT_IMAGE_25_OUTPUT_SCHEMA,
          catalogSnapshot: {
            model: `openai/gpt-image-2.5/${variant}/${operation}`,
            // Usage-dependent token cost; do not represent it as a fixed image cost.
            tokenPricing: {
              currency: 'USD',
              unit: 'million_tokens',
              verifiedAt: '2026-09-11',
              text: { input: 5, cachedInput: 1.25, output: 10 },
              image: { input: 8, cachedInput: 2, output: 30 },
            },
            docs: [
              {
                title: 'fal GPT Image 2.5 API',
                url: `https://fal.ai/models/openai/gpt-image-2.5/${variant}/${operation}/api`,
              },
            ],
          },
        }),
      ),
      providerAliases: [
        `fal/openai/gpt-image-2.5/${variant}/text-to-image`,
        `fal/openai/gpt-image-2.5/${variant}/edit`,
      ],
    }),
  ),
  {
    slug: 'flux-2-pro',
    displayName: 'Flux 2 Pro',
    family: 'flux',
    vendor: 'Black Forest Labs',
    description:
      'Black Forest Labs Flux 2 Pro for production photorealism, product marketing visuals, typography, color control, and multi-reference image editing up to 4 megapixels.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 30,
    parameterPolicy: FLUX_2_PRO_PARAMETER_POLICY,
    productPricing: FLUX_2_PRO_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 35,
    recommended: true,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/flux-2-pro',
        priority: 10,
        weight: 100,
        providerInputSchema: FAL_FLUX_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/flux-2-pro',
          usdPerUnit: 0.03,
          unit: 'MP',
          pricingSource: 'black_forest_labs_official_pricing',
          pricingNote:
            'FLUX.2 Pro text-to-image starts at $0.03 per output megapixel; editing starts at $0.045 per megapixel.',
          docsUrl:
            'https://fal.ai/docs/model-api-reference/image-generation-api/flux-2-pro',
        }),
        maxConcurrentRequests: 8,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/flux-2-pro'],
  },
  {
    slug: 'hunyuan-world',
    displayName: 'Hunyuan World',
    family: 'hunyuan',
    vendor: 'Tencent',
    description:
      'Tencent Hunyuan World 1.0 — expands a single image into a 2:1 equirectangular 360° panorama. Reached via the studio panorama (720°) action, not the model picker.',
    modes: [I2I],
    requiredPlan: null,
    cost: 40,
    parameterPolicy: HUNYUAN_WORLD_PARAMETER_POLICY,
    productPricing: HUNYUAN_WORLD_PRODUCT_PRICING,
    group: 'panorama',
    sortOrder: 200,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/hunyuan_world',
        priority: 10,
        weight: 100,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/hunyuan_world',
          usdPerImage: 0.15,
          docsUrl: 'https://fal.ai/models/fal-ai/hunyuan_world/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/hunyuan_world'],
  },
  {
    slug: 'topaz-upscale',
    displayName: 'Topaz Upscale',
    family: 'image-transform',
    vendor: 'Topaz Labs',
    description:
      'Topaz image upscaler — increases resolution with detail recovery. Reached via the studio Upscale action, not the model picker.',
    modes: [UPSCALE],
    requiredPlan: null,
    cost: 15,
    parameterPolicy: TOPAZ_UPSCALE_PARAMETER_POLICY,
    productPricing: TOPAZ_UPSCALE_PRODUCT_PRICING,
    group: 'tools',
    sortOrder: 210,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/topaz/upscale/image',
        modes: [UPSCALE],
        priority: 10,
        weight: 100,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/topaz/upscale/image',
          usdPerImage: 0.05,
          docsUrl: 'https://fal.ai/models/fal-ai/topaz/upscale/image/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/topaz/upscale/image'],
  },
  {
    slug: 'bria-rmbg',
    displayName: 'Remove Background',
    family: 'image-transform',
    vendor: 'Bria',
    description:
      'Bria background removal — mattes the subject out to a transparent image. Reached via the studio Remove BG action, not the model picker.',
    modes: [REMOVE_BG],
    requiredPlan: null,
    cost: 10,
    parameterPolicy: BRIA_RMBG_PARAMETER_POLICY,
    productPricing: BRIA_RMBG_PRODUCT_PRICING,
    group: 'tools',
    sortOrder: 211,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/bria/background/remove',
        modes: [REMOVE_BG],
        priority: 10,
        weight: 100,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/bria/background/remove',
          usdPerImage: 0.04,
          docsUrl: 'https://fal.ai/models/fal-ai/bria/background/remove/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/bria/background/remove'],
  },
  {
    slug: 'iclight-relight',
    displayName: 'Relight',
    family: 'image-transform',
    vendor: 'IC-Light',
    description:
      'IC-Light V2 relighting — re-lights the subject to match a described scene/lighting. Reached via the studio Relight action, not the model picker.',
    modes: [RELIGHT],
    requiredPlan: null,
    cost: 20,
    parameterPolicy: ICLIGHT_RELIGHT_PARAMETER_POLICY,
    productPricing: ICLIGHT_RELIGHT_PRODUCT_PRICING,
    group: 'tools',
    sortOrder: 212,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/iclight-v2',
        modes: [RELIGHT],
        priority: 10,
        weight: 100,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/iclight-v2',
          usdPerImage: 0.05,
          docsUrl: 'https://fal.ai/models/fal-ai/iclight-v2/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/iclight-v2'],
  },
  {
    slug: 'qwen-multi-angle',
    displayName: 'Multi-Angle',
    family: 'image-transform',
    vendor: 'Alibaba',
    description:
      'Qwen multiple-angles — re-shoots the subject from a new camera viewpoint (orbit / tilt / zoom). Reached via the studio Multi-Angle action, not the model picker.',
    modes: [MULTI_ANGLE],
    requiredPlan: null,
    cost: 18,
    parameterPolicy: QWEN_MULTI_ANGLE_PARAMETER_POLICY,
    productPricing: QWEN_MULTI_ANGLE_PRODUCT_PRICING,
    group: 'tools',
    sortOrder: 213,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/qwen-image-edit-2511-multiple-angles',
        modes: [MULTI_ANGLE],
        priority: 10,
        weight: 100,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/qwen-image-edit-2511-multiple-angles',
          usdPerImage: 0.04,
          docsUrl:
            'https://fal.ai/models/fal-ai/qwen-image-edit-2511-multiple-angles/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/qwen-image-edit-2511-multiple-angles'],
  },
  {
    slug: 'bria-expand',
    displayName: 'Expand',
    family: 'image-transform',
    vendor: 'Bria',
    description:
      'Bria image expand (outpainting) — grows the canvas and generatively fills the new area. Reached via the studio Expand action, not the model picker.',
    modes: [OUTPAINT],
    requiredPlan: null,
    cost: 15,
    parameterPolicy: BRIA_EXPAND_PARAMETER_POLICY,
    productPricing: BRIA_EXPAND_PRODUCT_PRICING,
    group: 'tools',
    sortOrder: 214,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/bria/expand',
        modes: [OUTPAINT],
        priority: 10,
        weight: 100,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/bria/expand',
          usdPerImage: 0.04,
          docsUrl: 'https://fal.ai/models/fal-ai/bria/expand/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/bria/expand'],
  },
  {
    slug: 'flux-2-flex',
    displayName: 'Flux 2 Flex',
    family: 'flux',
    vendor: 'Black Forest Labs',
    description:
      'Black Forest Labs Flux 2 Flex for typography-heavy production images and multi-reference editing with explicit guidance and inference-step controls.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 50,
    parameterPolicy: FLUX_2_FLEX_PARAMETER_POLICY,
    productPricing: FLUX_2_FLEX_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 36,
    recommended: true,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/flux-2-flex',
        priority: 10,
        weight: 100,
        providerInputSchema: FAL_FLUX_FLEX_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/flux-2-flex',
          usdPerUnit: 0.05,
          unit: 'MP',
          pricingSource: 'fal_public_flux_2_pricing',
          pricingNote:
            'fal.ai lists FLUX.2 Flex at $0.05 per megapixel; editing bills input and output megapixels rounded up separately.',
          docsUrl: 'https://fal.ai/models/fal-ai/flux-2-flex/api',
        }),
        maxConcurrentRequests: 6,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/flux-2-flex'],
  },
  {
    slug: 'flux-2-max',
    displayName: 'Flux 2 Max',
    family: 'flux',
    vendor: 'Black Forest Labs',
    description:
      'Black Forest Labs Flux 2 Max — the highest-fidelity FLUX.2 tier for premium photorealism, typography, precise color control, and multi-reference image editing up to 4 megapixels.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 70,
    parameterPolicy: FLUX_2_MAX_PARAMETER_POLICY,
    productPricing: FLUX_2_MAX_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 37,
    recommended: true,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/flux-2-max',
        priority: 10,
        weight: 100,
        providerInputSchema: FAL_FLUX_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/flux-2-max',
          usdPerUnit: 0.07,
          unit: 'MP',
          pricingSource: 'fal_public_flux_2_pricing',
          pricingNote:
            'fal.ai FLUX.2 [max]: $0.07 for the first output megapixel + $0.03 per additional megapixel (rounded up, up to ~4MP). Zero-config tier — no steps/guidance; one image per request.',
          docsUrl: 'https://fal.ai/models/fal-ai/flux-2-max/api',
        }),
        maxConcurrentRequests: 6,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/flux-2-max'],
  },
  {
    slug: 'flux-2-dev',
    displayName: 'Flux 2 Dev',
    family: 'flux',
    vendor: 'Black Forest Labs',
    description:
      'Black Forest Labs Flux 2 Dev — the open-weight FLUX.2 base model for low-cost, configurable generation with adjustable guidance and inference steps, multi-image batches, and reference editing.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 12,
    parameterPolicy: FLUX_2_DEV_PARAMETER_POLICY,
    productPricing: FLUX_2_DEV_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 34,
    recommended: false,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/flux-2',
        priority: 10,
        weight: 100,
        providerInputSchema: FAL_FLUX_FLEX_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/flux-2',
          usdPerUnit: 0.012,
          unit: 'MP',
          pricingSource: 'fal_public_flux_2_pricing',
          pricingNote:
            'fal.ai FLUX.2 [dev] (endpoint fal-ai/flux-2): flat $0.012 per output megapixel; exposes guidance_scale, num_inference_steps, and num_images (1-4).',
          docsUrl: 'https://fal.ai/models/fal-ai/flux-2/api',
        }),
        maxConcurrentRequests: 8,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['fal/fal-ai/flux-2'],
  },
  {
    slug: 'wan-image-2.7-pro',
    displayName: 'Wan Image 2.7 Pro',
    family: 'wan-image',
    vendor: 'Alibaba',
    description:
      'Alibaba Wan Image 2.7 Pro for high-fidelity text-to-image, reference-guided generation, image editing, and inpainting up to 4K.',
    modes: [T2I, I2I, INPAINT],
    requiredPlan: null,
    cost: 45,
    parameterPolicy: WAN_IMAGE_27_PRO_PARAMETER_POLICY,
    productPricing: WAN_IMAGE_27_PRO_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 20,
    recommended: true,
    providers: [
      {
        provider: 'aliyun-bailian',
        endpointId: 'wan2.7-image-pro',
        priority: 10,
        weight: 100,
        providerInputSchema: BAILIAN_MULTIMODAL_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: bailianCatalogSnapshot({
          model: 'wan2.7-image-pro',
          callMode: 'sync',
          cnRmbPerImage: 0.5,
          globalRmbPerImage: 0.562065,
          docsUrl:
            'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['bailian/wan2.7-image-pro'],
  },
  {
    slug: 'wan-image-2.7',
    displayName: 'Wan Image 2.7',
    family: 'wan-image',
    vendor: 'Alibaba',
    description:
      'Alibaba Wan Image 2.7 for efficient text-to-image, reference-guided generation, image editing, and inpainting up to 2K.',
    modes: [T2I, I2I, INPAINT],
    requiredPlan: null,
    cost: 20,
    parameterPolicy: WAN_IMAGE_27_PARAMETER_POLICY,
    productPricing: WAN_IMAGE_27_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 30,
    recommended: false,
    providers: [
      {
        provider: 'aliyun-bailian',
        endpointId: 'wan2.7-image',
        priority: 10,
        weight: 100,
        providerInputSchema: BAILIAN_MULTIMODAL_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: bailianCatalogSnapshot({
          model: 'wan2.7-image',
          callMode: 'sync',
          cnRmbPerImage: 0.2,
          globalRmbPerImage: 0.220177,
          docsUrl:
            'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference',
        }),
        maxConcurrentRequests: 6,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['bailian/wan2.7-image'],
  },
  {
    slug: 'qwen-image-2.0-pro',
    displayName: 'Qwen Image 2.0 Pro',
    family: 'qwen-image',
    vendor: 'Alibaba',
    description:
      'Alibaba Qwen Image 2.0 Pro for precise typography, semantic adherence, realistic text-to-image, and multi-image editing.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 35,
    parameterPolicy: QWEN_IMAGE_20_PRO_PARAMETER_POLICY,
    productPricing: QWEN_IMAGE_20_PRO_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 40,
    recommended: true,
    providers: [
      {
        provider: 'aliyun-bailian',
        endpointId: 'qwen-image-2.0-pro',
        priority: 10,
        weight: 100,
        providerInputSchema: BAILIAN_MULTIMODAL_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: bailianCatalogSnapshot({
          model: 'qwen-image-2.0-pro',
          callMode: 'sync',
          cnRmbPerImage: 0.5,
          globalRmbPerImage: 0.550443,
          docsUrl: 'https://help.aliyun.com/zh/model-studio/qwen-image-api',
        }),
        maxConcurrentRequests: 6,
        requestTimeoutSeconds: 300,
        failureThreshold: 3,
      },
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/qwen-image-2/pro/text-to-image',
        modes: [T2I],
        priority: 30,
        weight: 100,
        providerInputSchema: FAL_QWEN_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/qwen-image-2/pro/text-to-image',
          usdPerImage: 0.075,
          docsUrl:
            'https://fal.ai/models/fal-ai/qwen-image-2/pro/text-to-image',
        }),
      },
    ],
    providerAliases: [
      'bailian/qwen-image-2.0-pro',
      'fal/fal-ai/qwen-image-2/pro/text-to-image',
    ],
  },
  {
    slug: 'qwen-image-2.0',
    displayName: 'Qwen Image 2.0',
    family: 'qwen-image',
    vendor: 'Alibaba',
    description:
      'Alibaba Qwen Image 2.0 for balanced speed, text rendering, semantic adherence, and image editing.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 20,
    parameterPolicy: QWEN_IMAGE_20_PARAMETER_POLICY,
    productPricing: QWEN_IMAGE_20_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 50,
    recommended: false,
    providers: [
      {
        provider: 'aliyun-bailian',
        endpointId: 'qwen-image-2.0',
        priority: 10,
        weight: 100,
        providerInputSchema: BAILIAN_MULTIMODAL_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: bailianCatalogSnapshot({
          model: 'qwen-image-2.0',
          callMode: 'sync',
          cnRmbPerImage: 0.2,
          globalRmbPerImage: 0.256873,
          docsUrl: 'https://help.aliyun.com/zh/model-studio/qwen-image-api',
        }),
        maxConcurrentRequests: 8,
        requestTimeoutSeconds: 300,
        failureThreshold: 3,
      },
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/qwen-image-2/text-to-image',
        modes: [T2I],
        priority: 30,
        weight: 100,
        providerInputSchema: FAL_QWEN_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: falCatalogSnapshot({
          model: 'fal-ai/qwen-image-2/text-to-image',
          usdPerImage: 0.035,
          docsUrl: 'https://fal.ai/models/fal-ai/qwen-image-2/text-to-image',
        }),
      },
    ],
    providerAliases: [
      'bailian/qwen-image-2.0',
      'fal/fal-ai/qwen-image-2/text-to-image',
    ],
  },
  {
    slug: 'nano-banana',
    displayName: 'Nano Banana',
    family: 'nano-banana',
    vendor: 'Google',
    description:
      'Fast, low-cost image generation and reference-guided editing model for everyday creative variations.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 10,
    parameterPolicy: NANO_BANANA_PARAMETER_POLICY,
    productPricing: NANO_BANANA_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 60,
    recommended: false,
    providers: [
      {
        provider: 'google-vertex',
        endpointId: 'gemini-2.5-flash-image',
        modes: [T2I, I2I],
        priority: 10,
        weight: 100,
        providerInputSchema: GOOGLE_GEMINI_IMAGE_INPUT_SCHEMA,
        providerOutputSchema: GOOGLE_GEMINI_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: googleGeminiImageSnapshot('gemini-2.5-flash-image'),
        maxConcurrentRequests: 2,
        requestTimeoutSeconds: 300,
        failureThreshold: 3,
      },
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/nano-banana',
        priority: 30,
        weight: 100,
      },
    ],
    providerAliases: [
      'google-vertex/gemini-2.5-flash-image',
      'fal/fal-ai/nano-banana',
    ],
  },
  {
    slug: 'quick-image-1-0',
    displayName: 'Agnes Image 2.1 Flash',
    family: 'quick-image',
    vendor: 'Agnes AI',
    description:
      'Agnes AI lightweight image model for text-to-image and single-reference image editing.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 6,
    parameterPolicy: QUICK_IMAGE_PARAMETER_POLICY,
    productPricing: QUICK_IMAGE_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 65,
    recommended: false,
    providers: [
      {
        provider: 'agnes-ai',
        endpointId: 'agnes-image-2.1-flash',
        modes: [T2I, I2I],
        priority: 100,
        maxConcurrentRequests: 1,
        maxRequestsPerMinute: 20,
        requestTimeoutSeconds: 300,
        cooldownSeconds: 30,
        failureThreshold: 3,
        catalogSnapshot: {
          docs: [
            {
              title: 'Agnes Image 2.1 Flash',
              url: 'https://agnes-ai.com/doc/agnes-image-21-flash',
            },
          ],
          model: 'agnes-image-2.1-flash',
          pricing: { source: 'provider_account' },
        },
      },
    ],
    providerAliases: ['agnes/agnes-image-2.1-flash'],
  },
  {
    slug: 'nano-banana-2-lite',
    displayName: 'Nano Banana 2 Lite',
    family: 'nano-banana',
    vendor: 'Google',
    description:
      'Google ultra-low-latency image generation and editing at native 1K resolution with up to 14 visual references.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 10,
    parameterPolicy: NANO_BANANA_2_LITE_PARAMETER_POLICY,
    productPricing: NANO_BANANA_2_LITE_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 68,
    recommended: false,
    providers: [
      {
        provider: 'google-vertex',
        endpointId: 'gemini-3.1-flash-lite-image',
        modes: [T2I, I2I],
        priority: 10,
        weight: 100,
        providerInputSchema: GOOGLE_GEMINI_IMAGE_INPUT_SCHEMA,
        providerOutputSchema: GOOGLE_GEMINI_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: googleGeminiImageSnapshot(
          'gemini-3.1-flash-lite-image',
        ),
        maxConcurrentRequests: 2,
        requestTimeoutSeconds: 300,
        failureThreshold: 3,
      },
    ],
    providerAliases: ['google-vertex/gemini-3.1-flash-lite-image'],
  },
  {
    slug: 'nano-banana-2',
    displayName: 'Nano Banana 2',
    family: 'nano-banana',
    vendor: 'Google',
    description:
      'Balanced image generation and editing model with higher reference-image capacity and selectable output resolution.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 20,
    parameterPolicy: NANO_BANANA_2_PARAMETER_POLICY,
    productPricing: NANO_BANANA_2_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 70,
    recommended: true,
    providers: [
      {
        provider: 'google-vertex',
        endpointId: 'gemini-3.1-flash-image',
        modes: [T2I, I2I],
        priority: 10,
        weight: 100,
        providerInputSchema: GOOGLE_GEMINI_IMAGE_INPUT_SCHEMA,
        providerOutputSchema: GOOGLE_GEMINI_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: googleGeminiImageSnapshot('gemini-3.1-flash-image'),
        // Fourteen 7 MB inline references expand under base64. Bound each
        // endpoint so valid worst-case requests stay within the 1 GiB server
        // pod limit instead of turning provider capability into an OOM path.
        maxConcurrentRequests: 2,
        requestTimeoutSeconds: 300,
        failureThreshold: 3,
      },
    ],
    providerAliases: [
      'google-vertex/gemini-3.1-flash-image',
      'fal/fal-ai/nano-banana-2',
    ],
  },
  {
    slug: 'nano-banana-pro',
    displayName: 'Nano Banana Pro',
    family: 'nano-banana',
    vendor: 'Google',
    description:
      'Premium image generation and editing model for high-fidelity creative output at 2K and 4K resolutions.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 50,
    parameterPolicy: NANO_BANANA_PRO_PARAMETER_POLICY,
    productPricing: NANO_BANANA_PRO_PRODUCT_PRICING,
    group: 'premium',
    sortOrder: 80,
    recommended: false,
    providers: [
      {
        provider: 'google-vertex',
        endpointId: 'gemini-3-pro-image',
        modes: [T2I, I2I],
        priority: 10,
        weight: 100,
        providerInputSchema: GOOGLE_GEMINI_IMAGE_INPUT_SCHEMA,
        providerOutputSchema: GOOGLE_GEMINI_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: googleGeminiImageSnapshot('gemini-3-pro-image'),
        // Same inline-memory bound as Nano Banana 2; this is an application
        // execution limit, not an invented Google API quota.
        maxConcurrentRequests: 2,
        requestTimeoutSeconds: 300,
        failureThreshold: 3,
      },
    ],
    providerAliases: [
      'google-vertex/gemini-3-pro-image',
      'fal/fal-ai/nano-banana-pro',
    ],
  },
  {
    slug: 'seedream-4.5',
    displayName: 'Seedream 4.5',
    family: 'seedream',
    vendor: 'ByteDance',
    description:
      'ByteDance Seedream 4.5 image generation and editing model for higher-fidelity 2K and 4K creative output.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 12,
    parameterPolicy: SEEDREAM_45_PARAMETER_POLICY,
    productPricing: SEEDREAM_45_PRODUCT_PRICING,
    group: 'premium',
    sortOrder: 100,
    recommended: false,
    providers: [
      {
        provider: 'byteplus-modelark',
        endpointId: 'seedream-4-5-251128',
        priority: 10,
        weight: 100,
      },
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
        priority: 20,
        weight: 100,
      },
    ],
    providerAliases: [
      'byteplus/seedream-4-5-251128',
      'fal/fal-ai/bytedance/seedream/v4.5/text-to-image',
    ],
  },
  {
    slug: 'seedream-5-lite',
    displayName: 'Seedream 5.0 Lite',
    family: 'seedream',
    vendor: 'ByteDance',
    description:
      'ByteDance Seedream 5.0 Lite image generation and reference-guided editing model optimized for efficient 2K, 3K, and 4K output.',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 10,
    parameterPolicy: SEEDREAM_5_LITE_PARAMETER_POLICY,
    productPricing: SEEDREAM_5_LITE_PRODUCT_PRICING,
    group: 'premium',
    sortOrder: 110,
    recommended: false,
    providers: [
      {
        provider: 'byteplus-modelark',
        endpointId: 'seedream-5-0-lite-260128',
        priority: 10,
        weight: 100,
      },
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/bytedance/seedream/v5/lite/text-to-image',
        priority: 20,
        weight: 100,
      },
    ],
    providerAliases: [
      'byteplus/seedream-5-0-lite-260128',
      'fal/fal-ai/bytedance/seedream/v5/lite/text-to-image',
    ],
  },
  {
    slug: 'seedream-5-pro',
    displayName: 'Seedream 5.0 Pro',
    family: 'seedream',
    vendor: 'ByteDance',
    description:
      'ByteDance Seedream 5.0 Pro — newest flagship image generation and precise editing model with full layer control (2K output).',
    modes: [T2I, I2I],
    requiredPlan: null,
    cost: 15,
    parameterPolicy: SEEDREAM_5_PRO_PARAMETER_POLICY,
    productPricing: SEEDREAM_5_PRO_PRODUCT_PRICING,
    group: 'premium',
    sortOrder: 120,
    recommended: false,
    providers: [
      {
        provider: 'byteplus-modelark',
        endpointId: 'dola-seedream-5-0-pro-260628',
        priority: 10,
        weight: 100,
      },
    ],
    providerAliases: ['byteplus/dola-seedream-5-0-pro-260628'],
  },
];
