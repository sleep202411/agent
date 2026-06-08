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
  GPT_IMAGE_2_PARAMETER_POLICY,
  GPT_IMAGE_2_PRODUCT_PRICING,
  NANO_BANANA_2_PARAMETER_POLICY,
  NANO_BANANA_2_PRODUCT_PRICING,
  NANO_BANANA_PARAMETER_POLICY,
  NANO_BANANA_PRODUCT_PRICING,
  NANO_BANANA_PRO_PARAMETER_POLICY,
  NANO_BANANA_PRO_PRODUCT_PRICING,
  SEEDREAM_45_PARAMETER_POLICY,
  SEEDREAM_45_PRODUCT_PRICING,
  SEEDREAM_4_PARAMETER_POLICY,
  SEEDREAM_4_PRODUCT_PRICING,
  SEEDREAM_5_LITE_PARAMETER_POLICY,
  SEEDREAM_5_LITE_PRODUCT_PRICING,
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
    sortOrder: 20,
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
    sortOrder: 30,
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
    sortOrder: 40,
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
    sortOrder: 50,
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
    sortOrder: 60,
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
    sortOrder: 70,
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
