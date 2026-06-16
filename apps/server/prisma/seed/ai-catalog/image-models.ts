/**
 * Declarative catalog of canonical AI image models.
 *
 * One clean entry per canonical model — NO policy boilerplate here (that lives
 * in `defaults.ts` and is merged by `seed-catalog.ts`). The `providers` array
 * lists ONLY provider entries that map to a reconciled `AiProviderAccount`
 * (`fal-ai`, `aliyun-bailian`, `microsoft-foundry`, `replicate`); each entry
 * seeds an `AiProviderEndpoint` + a runtime-valid
 * `AiProviderModelBinding`. A model whose only upstream providers have no
 * reconciled account (e.g. midjourney, raw minimax) carries `providers: []`
 * and is seeded as canonical-only (no binding — valid, just can't generate
 * yet).
 *
 * Every entry below is a reviewed product-facing ContainerModel. Provider
 * endpoints stay implementation details; user-visible controls and pricing are
 * defined at the canonical model layer.
 */
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
  GPT_IMAGE_2_PARAMETER_POLICY,
  GPT_IMAGE_2_PRODUCT_PRICING,
  HUNYUAN_WORLD_PARAMETER_POLICY,
  HUNYUAN_WORLD_PRODUCT_PRICING,
  NANO_BANANA_2_PARAMETER_POLICY,
  NANO_BANANA_2_PRODUCT_PRICING,
  NANO_BANANA_PARAMETER_POLICY,
  NANO_BANANA_PRODUCT_PRICING,
  NANO_BANANA_PRO_PARAMETER_POLICY,
  NANO_BANANA_PRO_PRODUCT_PRICING,
  QWEN_IMAGE_20_PARAMETER_POLICY,
  QWEN_IMAGE_20_PRODUCT_PRICING,
  QWEN_IMAGE_20_PRO_PARAMETER_POLICY,
  QWEN_IMAGE_20_PRO_PRODUCT_PRICING,
  SEEDREAM_45_PARAMETER_POLICY,
  SEEDREAM_45_PRODUCT_PRICING,
  SEEDREAM_4_PARAMETER_POLICY,
  SEEDREAM_4_PRODUCT_PRICING,
  SEEDREAM_5_LITE_PARAMETER_POLICY,
  SEEDREAM_5_LITE_PRODUCT_PRICING,
  WAN_IMAGE_27_PARAMETER_POLICY,
  WAN_IMAGE_27_PRODUCT_PRICING,
  WAN_IMAGE_27_PRO_PARAMETER_POLICY,
  WAN_IMAGE_27_PRO_PRODUCT_PRICING,
  type RequiredPlan,
} from './defaults';

/** The reconciled provider-account keys (see `AI_PROVIDER_KEYS`). */
export type ProviderKey =
  | 'fal-ai'
  | 'byteplus-modelark'
  | 'aliyun-bailian'
  | 'microsoft-foundry'
  | 'replicate';

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
  description: string;
  modes: AiGenerationMode[];
  /** Entitlement tier; `null` = free. Drives queue caps + priority too. */
  tier: RequiredPlan;
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

const REPLICATE_GENERIC_IMAGE_INPUT_SCHEMA = {
  type: 'object',
  required: ['input'],
  properties: {
    input: { type: 'object' },
  },
} as const satisfies Prisma.InputJsonObject;

const REPLICATE_FLUX_INPUT_SCHEMA = {
  type: 'object',
  required: ['input'],
  properties: {
    input: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        input_images: { type: 'array', items: { type: 'string' } },
        aspect_ratio: { type: 'string' },
        resolution: { type: 'string' },
        seed: { type: 'integer' },
        output_format: { type: 'string' },
        output_quality: { type: 'integer' },
        safety_tolerance: { type: 'integer' },
        prompt_upsampling: { type: 'boolean' },
      },
    },
  },
} as const satisfies Prisma.InputJsonObject;

const REPLICATE_FLUX_FLEX_INPUT_SCHEMA = {
  type: 'object',
  required: ['input'],
  properties: {
    input: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        input_images: { type: 'array', items: { type: 'string' } },
        aspect_ratio: { type: 'string' },
        resolution: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        seed: { type: 'integer' },
        steps: { type: 'integer' },
        guidance: { type: 'number' },
        output_format: { type: 'string' },
        output_quality: { type: 'integer' },
        safety_tolerance: { type: 'integer' },
        prompt_upsampling: { type: 'boolean' },
      },
    },
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

function replicateCatalogSnapshot(args: {
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
      source: args.pricingSource ?? 'replicate_public_pricing',
      unit: args.unit ?? 'image',
      currency: 'USD',
      unitPrice: args.usdPerUnit ?? args.usdPerImage,
      ...(args.pricingNote ? { note: args.pricingNote } : {}),
    },
    docs: [{ title: 'Replicate API reference', url: args.docsUrl }],
    model: args.model,
  };
}

export const IMAGE_MODELS: ImageModelSeed[] = [
  {
    slug: 'gpt-image-2',
    displayName: 'GPT Image 2',
    family: 'gpt-image',
    description:
      'OpenAI image generation and editing model for instruction-following, typography, layout, product mockups, and structured visual edits.',
    modes: [T2I, I2I, INPAINT],
    tier: 'vip',
    cost: 60,
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
      {
        provider: 'replicate',
        endpointId: 'openai/gpt-image-2',
        modes: [T2I, I2I],
        priority: 20,
        weight: 100,
      },
    ],
    providerAliases: ['fal/openai/gpt-image-2', 'replicate/openai/gpt-image-2'],
  },
  {
    slug: 'flux-2-pro',
    displayName: 'Flux 2 Pro',
    family: 'flux',
    description:
      'Black Forest Labs Flux 2 Pro for production photorealism, product marketing visuals, typography, color control, and multi-reference image editing up to 4 megapixels.',
    modes: [T2I, I2I],
    tier: 'vip',
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
      {
        provider: 'replicate',
        endpointId: 'black-forest-labs/flux-2-pro',
        priority: 30,
        weight: 90,
        providerInputSchema: REPLICATE_FLUX_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: replicateCatalogSnapshot({
          model: 'black-forest-labs/flux-2-pro',
          usdPerUnit: 0.03,
          unit: 'MP',
          pricingSource: 'replicate_model_page_and_bfl_official_pricing',
          pricingNote:
            'Replicate lists this model as priced by input and output megapixels; BFL official pricing starts at $0.03 per output megapixel.',
          docsUrl: 'https://replicate.com/black-forest-labs/flux-2-pro/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: [
      'fal/fal-ai/flux-2-pro',
      'replicate/black-forest-labs/flux-2-pro',
    ],
  },
  {
    slug: 'hunyuan-world',
    displayName: 'Hunyuan World',
    family: 'hunyuan',
    description:
      'Tencent Hunyuan World 1.0 — expands a single image into a 2:1 equirectangular 360° panorama. Reached via the studio panorama (720°) action, not the model picker.',
    modes: [I2I],
    tier: 'vip',
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
    slug: 'flux-2-flex',
    displayName: 'Flux 2 Flex',
    family: 'flux',
    description:
      'Black Forest Labs Flux 2 Flex for typography-heavy production images and multi-reference editing with explicit guidance and inference-step controls.',
    modes: [T2I, I2I],
    tier: 'vip',
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
      {
        provider: 'replicate',
        endpointId: 'black-forest-labs/flux-2-flex',
        priority: 30,
        weight: 90,
        providerInputSchema: REPLICATE_FLUX_FLEX_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: replicateCatalogSnapshot({
          model: 'black-forest-labs/flux-2-flex',
          usdPerUnit: 0.06,
          unit: 'MP',
          pricingSource: 'replicate_model_page_and_bfl_official_pricing',
          pricingNote:
            'Replicate lists this model as priced by input and output megapixels; BFL official pricing starts at $0.06 per megapixel for FLUX.2 Flex.',
          docsUrl: 'https://replicate.com/black-forest-labs/flux-2-flex/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: [
      'fal/fal-ai/flux-2-flex',
      'replicate/black-forest-labs/flux-2-flex',
    ],
  },
  {
    slug: 'flux-2-max',
    displayName: 'Flux 2 Max',
    family: 'flux',
    description:
      'Black Forest Labs Flux 2 Max — the highest-fidelity FLUX.2 tier for premium photorealism, typography, precise color control, and multi-reference image editing up to 4 megapixels.',
    modes: [T2I, I2I],
    tier: 'vip',
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
      {
        provider: 'replicate',
        endpointId: 'black-forest-labs/flux-2-max',
        priority: 30,
        weight: 90,
        providerInputSchema: REPLICATE_FLUX_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: replicateCatalogSnapshot({
          model: 'black-forest-labs/flux-2-max',
          usdPerUnit: 0.03,
          unit: 'MP',
          pricingSource: 'replicate_billing_config_official',
          pricingNote:
            'Replicate FLUX.2 [max]: $0.04 per run + $0.03 per input megapixel + $0.03 per output megapixel; one image per run, up to 8 reference images.',
          docsUrl: 'https://replicate.com/black-forest-labs/flux-2-max/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: [
      'fal/fal-ai/flux-2-max',
      'replicate/black-forest-labs/flux-2-max',
    ],
  },
  {
    slug: 'flux-2-dev',
    displayName: 'Flux 2 Dev',
    family: 'flux',
    description:
      'Black Forest Labs Flux 2 Dev — the open-weight FLUX.2 base model for low-cost, configurable generation with adjustable guidance and inference steps, multi-image batches, and reference editing.',
    modes: [T2I, I2I],
    tier: 'vip',
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
      {
        provider: 'replicate',
        endpointId: 'black-forest-labs/flux-2-dev',
        priority: 30,
        weight: 90,
        providerInputSchema: REPLICATE_FLUX_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: replicateCatalogSnapshot({
          model: 'black-forest-labs/flux-2-dev',
          usdPerUnit: 0.012,
          unit: 'MP',
          pricingSource: 'replicate_official_pricing',
          pricingNote:
            'Replicate FLUX.2 [dev]: $0.012 per input and output megapixel; distilled (no steps param), up to 4 reference images, one image per run.',
          docsUrl: 'https://replicate.com/black-forest-labs/flux-2-dev/api',
        }),
        maxConcurrentRequests: 4,
        requestTimeoutSeconds: 600,
        failureThreshold: 3,
      },
    ],
    providerAliases: [
      'fal/fal-ai/flux-2',
      'replicate/black-forest-labs/flux-2-dev',
    ],
  },
  {
    slug: 'wan-image-2.7-pro',
    displayName: 'Wan Image 2.7 Pro',
    family: 'wan-image',
    description:
      'Alibaba Wan Image 2.7 Pro for high-fidelity text-to-image, reference-guided generation, image editing, and inpainting up to 4K.',
    modes: [T2I, I2I, INPAINT],
    tier: 'vip',
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
      {
        provider: 'replicate',
        endpointId: 'wan-video/wan-2.7-image-pro',
        priority: 30,
        weight: 100,
        providerInputSchema: REPLICATE_GENERIC_IMAGE_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: replicateCatalogSnapshot({
          model: 'wan-video/wan-2.7-image-pro',
          usdPerImage: 0.03,
          docsUrl: 'https://replicate.com/wan-video/wan-2.7-image-pro/api',
        }),
      },
    ],
    providerAliases: [
      'bailian/wan2.7-image-pro',
      'replicate/wan-video/wan-2.7-image-pro',
    ],
  },
  {
    slug: 'wan-image-2.7',
    displayName: 'Wan Image 2.7',
    family: 'wan-image',
    description:
      'Alibaba Wan Image 2.7 for efficient text-to-image, reference-guided generation, image editing, and inpainting up to 2K.',
    modes: [T2I, I2I, INPAINT],
    tier: 'vip',
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
    description:
      'Alibaba Qwen Image 2.0 Pro for precise typography, semantic adherence, realistic text-to-image, and multi-image editing.',
    modes: [T2I, I2I],
    tier: 'vip',
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
      {
        provider: 'replicate',
        endpointId: 'qwen/qwen-image-2-pro',
        priority: 40,
        weight: 80,
        providerInputSchema: REPLICATE_GENERIC_IMAGE_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: replicateCatalogSnapshot({
          model: 'qwen/qwen-image-2-pro',
          usdPerImage: 0.075,
          docsUrl: 'https://replicate.com/qwen/qwen-image-2-pro/api',
        }),
      },
    ],
    providerAliases: [
      'bailian/qwen-image-2.0-pro',
      'fal/fal-ai/qwen-image-2/pro/text-to-image',
      'replicate/qwen/qwen-image-2-pro',
    ],
  },
  {
    slug: 'qwen-image-2.0',
    displayName: 'Qwen Image 2.0',
    family: 'qwen-image',
    description:
      'Alibaba Qwen Image 2.0 for balanced speed, text rendering, semantic adherence, and image editing.',
    modes: [T2I, I2I],
    tier: 'vip',
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
      {
        provider: 'replicate',
        endpointId: 'qwen/qwen-image-2512',
        priority: 40,
        weight: 80,
        providerInputSchema: REPLICATE_GENERIC_IMAGE_INPUT_SCHEMA,
        providerOutputSchema: PROVIDER_IMAGE_OUTPUT_SCHEMA,
        catalogSnapshot: replicateCatalogSnapshot({
          model: 'qwen/qwen-image-2512',
          usdPerImage: 0.02,
          docsUrl: 'https://replicate.com/qwen/qwen-image-2512/api',
        }),
      },
    ],
    providerAliases: [
      'bailian/qwen-image-2.0',
      'fal/fal-ai/qwen-image-2/text-to-image',
      'replicate/qwen/qwen-image-2512',
    ],
  },
  {
    slug: 'nano-banana',
    displayName: 'Nano Banana',
    family: 'nano-banana',
    description:
      'Fast, low-cost image generation and reference-guided editing model for everyday creative variations.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 10,
    parameterPolicy: NANO_BANANA_PARAMETER_POLICY,
    productPricing: NANO_BANANA_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 60,
    recommended: false,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/nano-banana',
        priority: 10,
        weight: 100,
      },
      {
        provider: 'replicate',
        endpointId: 'google/nano-banana',
        priority: 20,
        weight: 100,
      },
    ],
    providerAliases: ['fal/fal-ai/nano-banana', 'replicate/google/nano-banana'],
  },
  {
    slug: 'nano-banana-2',
    displayName: 'Nano Banana 2',
    family: 'nano-banana',
    description:
      'Balanced image generation and editing model with higher reference-image capacity and selectable output resolution.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 20,
    parameterPolicy: NANO_BANANA_2_PARAMETER_POLICY,
    productPricing: NANO_BANANA_2_PRODUCT_PRICING,
    group: 'recommended',
    sortOrder: 70,
    recommended: true,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/nano-banana-2',
        priority: 10,
        weight: 100,
      },
      {
        provider: 'replicate',
        endpointId: 'google/nano-banana-2',
        priority: 20,
        weight: 100,
      },
    ],
    providerAliases: [
      'fal/fal-ai/nano-banana-2',
      'replicate/google/nano-banana-2',
    ],
  },
  {
    slug: 'nano-banana-pro',
    displayName: 'Nano Banana Pro',
    family: 'nano-banana',
    description:
      'Premium image generation and editing model for high-fidelity creative output at 2K and 4K resolutions.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 50,
    parameterPolicy: NANO_BANANA_PRO_PARAMETER_POLICY,
    productPricing: NANO_BANANA_PRO_PRODUCT_PRICING,
    group: 'premium',
    sortOrder: 80,
    recommended: false,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/nano-banana-pro',
        priority: 10,
        weight: 100,
      },
      {
        provider: 'replicate',
        endpointId: 'google/nano-banana-pro',
        priority: 20,
        weight: 100,
      },
    ],
    providerAliases: [
      'fal/fal-ai/nano-banana-pro',
      'replicate/google/nano-banana-pro',
    ],
  },
  {
    slug: 'seedream-4',
    displayName: 'Seedream 4.0',
    family: 'seedream',
    description:
      'ByteDance Seedream 4.0 image generation and reference-guided editing model with broad aspect ratio support up to 4K.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 30,
    parameterPolicy: SEEDREAM_4_PARAMETER_POLICY,
    productPricing: SEEDREAM_4_PRODUCT_PRICING,
    group: 'premium',
    sortOrder: 90,
    recommended: false,
    providers: [
      {
        provider: 'byteplus-modelark',
        endpointId: 'seedream-4-0-250828',
        priority: 10,
        weight: 100,
      },
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/bytedance/seedream/v4/text-to-image',
        priority: 20,
        weight: 100,
      },
      {
        provider: 'replicate',
        endpointId: 'bytedance/seedream-4',
        priority: 30,
        weight: 100,
      },
    ],
    providerAliases: [
      'byteplus/seedream-4-0-250828',
      'fal/fal-ai/bytedance/seedream/v4/text-to-image',
      'replicate/bytedance/seedream-4',
    ],
  },
  {
    slug: 'seedream-4.5',
    displayName: 'Seedream 4.5',
    family: 'seedream',
    description:
      'ByteDance Seedream 4.5 image generation and editing model for higher-fidelity 2K and 4K creative output.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 40,
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
      {
        provider: 'replicate',
        endpointId: 'bytedance/seedream-4.5',
        priority: 30,
        weight: 100,
      },
    ],
    providerAliases: [
      'byteplus/seedream-4-5-251128',
      'fal/fal-ai/bytedance/seedream/v4.5/text-to-image',
      'replicate/bytedance/seedream-4.5',
    ],
  },
  {
    slug: 'seedream-5-lite',
    displayName: 'Seedream 5.0 Lite',
    family: 'seedream',
    description:
      'ByteDance Seedream 5.0 Lite image generation and reference-guided editing model optimized for efficient 2K, 3K, and 4K output.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 35,
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
      {
        provider: 'replicate',
        endpointId: 'bytedance/seedream-5-lite',
        priority: 30,
        weight: 100,
      },
    ],
    providerAliases: [
      'byteplus/seedream-5-0-lite-260128',
      'fal/fal-ai/bytedance/seedream/v5/lite/text-to-image',
      'replicate/bytedance/seedream-5-lite',
    ],
  },
];
