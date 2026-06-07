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
 * We intentionally start with one product-facing ContainerModel:
 * `gpt-image-2`. Other image models stay out of the product catalog until their
 * provider docs, parameter policies, runtime mappings, and pricing rules are
 * reviewed one by one.
 */
import type { AiGenerationMode, AiProductPricingPolicy } from '@repo/shared';

import { GPT_IMAGE_2_PRODUCT_PRICING, type RequiredPlan } from './defaults';

/** The reconciled provider-account keys (see `AI_PROVIDER_KEYS`). */
export type ProviderKey =
  | 'fal-ai'
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
];
