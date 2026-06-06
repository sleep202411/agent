/**
 * Declarative catalog of canonical AI image models.
 *
 * One clean entry per canonical model — NO policy boilerplate here (that lives
 * in `defaults.ts` and is merged by `seed-catalog.ts`). The `providers` array
 * lists ONLY provider entries that map to a reconciled `AiProviderAccount`
 * (`fal-ai`, `aliyun-bailian`, `microsoft-foundry`, `replicate`,
 * `omnirouters`); each entry seeds an `AiProviderEndpoint` + a runtime-valid
 * `AiProviderModelBinding`. A model whose only upstream providers have no
 * reconciled account (e.g. midjourney, raw minimax) carries `providers: []`
 * and is seeded as canonical-only (no binding — valid, just can't generate
 * yet).
 *
 * `providerAliases` preserves the original alias strings purely for metadata
 * provenance; they are NOT provider-account keys.
 */
import type { AiGenerationMode } from '@repo/shared';

import type { RequiredPlan } from './defaults';

/** The 5 reconciled provider-account keys (see `AI_PROVIDER_KEYS`). */
export type ProviderKey =
  | 'fal-ai'
  | 'aliyun-bailian'
  | 'microsoft-foundry'
  | 'replicate'
  | 'omnirouters';

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
  /** Preflight cost in compute points. */
  cost: number;
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

/**
 * Deprecated generic slugs from the first-generation catalog. The seeder
 * archives these (status `archived`, visibility `hidden`, `archivedAt=now`)
 * before upserting the explicit, versioned slugs below.
 */
export const DEPRECATED_GENERIC_SLUGS = [
  'nano-banana',
  'gpt-image',
  'seedream',
  'flux',
  'ideogram',
  'recraft',
];

export const IMAGE_MODELS: ImageModelSeed[] = [
  {
    slug: 'gpt-image-2',
    displayName: 'GPT Image 2',
    family: 'gpt-image',
    description:
      'OpenAI image generation and editing model for instruction-following, typography, layout, product mockups, and structured visual edits.',
    modes: [T2I, I2I, INPAINT],
    tier: 'vip',
    cost: 4,
    group: 'recommended',
    sortOrder: 10,
    recommended: true,
    // fal exposes GPT Image 2 under the `openai/gpt-image-2` path.
    providers: [{ provider: 'fal-ai', endpointId: 'openai/gpt-image-2' }],
    providerAliases: ['openai/gpt-image-2', 'fal/gpt-image-2'],
  },
  {
    slug: 'nano-banana-2',
    displayName: 'Nano Banana 2',
    family: 'nano-banana',
    description:
      'Google image model for high-quality general image generation, edits, and visual reference following.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 3,
    group: 'recommended',
    sortOrder: 20,
    recommended: true,
    providers: [{ provider: 'fal-ai', endpointId: 'nano-banana-2' }],
    providerAliases: ['google/nano-banana-2', 'fal/nano-banana-2'],
  },
  {
    slug: 'seedream-v5',
    displayName: 'Seedream v5',
    family: 'seedream',
    description:
      'ByteDance image model for commercial visuals, portrait work, Chinese prompts, and precise image edits.',
    modes: [T2I, I2I, INPAINT],
    tier: null,
    cost: 2,
    group: 'recommended',
    sortOrder: 30,
    recommended: true,
    providers: [{ provider: 'fal-ai', endpointId: 'seedream-v5' }],
    providerAliases: ['bytedance/seedream-v5', 'fal/seedream-v5'],
  },
  {
    slug: 'qwen-image',
    displayName: 'Qwen Image',
    family: 'qwen-image',
    description:
      'Alibaba Qwen image model optimized for Chinese text rendering, posters, and Model Studio routing.',
    modes: [T2I, I2I],
    tier: null,
    cost: 2,
    group: 'recommended',
    sortOrder: 40,
    recommended: true,
    // Qwen has both a fal route and a native Bailian (Model Studio) route.
    // Only fal-ai has a runtime catalog adapter for bindings today, so the
    // aliyun-bailian endpoint seeds canonical-without-runtime until its
    // adapter reads bindings; the fal route is the live one.
    providers: [{ provider: 'fal-ai', endpointId: 'qwen-image' }],
    providerAliases: ['aliyun/qwen-image', 'fal/qwen-image'],
  },
  {
    slug: 'flux-2-max',
    displayName: 'Flux.2 Max',
    family: 'flux',
    description:
      'Black Forest Labs Flux model for photorealistic generation, open ecosystem routing, and cost-flexible provider fallback.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 3,
    group: 'photoreal',
    sortOrder: 50,
    providers: [{ provider: 'fal-ai', endpointId: 'flux-2-max' }],
    providerAliases: ['black-forest-labs/flux-2-max', 'fal/flux-2-max'],
  },
  {
    slug: 'midjourney-v7',
    displayName: 'Midjourney V7',
    family: 'midjourney',
    description:
      'Midjourney-style art direction model entry for premium cinematic, illustration, and style-heavy image generation.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 5,
    group: 'premium',
    sortOrder: 60,
    // No reconciled account backs `midjourney/v7` → canonical-only, no binding.
    providers: [],
    providerAliases: ['midjourney/v7'],
  },
  {
    slug: 'recraft-v4-1',
    displayName: 'Recraft v4.1',
    family: 'recraft',
    description:
      'Design production model for brand graphics, illustration, icons, marketing assets, and reusable visual systems.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 3,
    group: 'design',
    sortOrder: 70,
    // fal exposes Recraft v4.1 under the explicit `recraft/v4.1/text-to-image`
    // endpoint path.
    providers: [
      { provider: 'fal-ai', endpointId: 'recraft/v4.1/text-to-image' },
    ],
    providerAliases: ['recraft/v4.1', 'fal/recraft/v4.1/text-to-image'],
  },
  {
    slug: 'ideogram-v4',
    displayName: 'Ideogram v4',
    family: 'ideogram',
    description:
      'Design-oriented image model for text-heavy posters, typography, logos, and layout-sensitive visuals.',
    modes: [T2I, I2I],
    tier: 'vip',
    cost: 3,
    group: 'design',
    sortOrder: 80,
    providers: [{ provider: 'fal-ai', endpointId: 'ideogram/v4' }],
    providerAliases: ['ideogram/v4', 'fal/ideogram/v4'],
  },
  {
    slug: 'krea-flux-1',
    displayName: 'Krea Flux 1',
    family: 'krea-flux',
    description:
      'Krea Flux entry for fast creative exploration, visual style iteration, and reference-driven concepts.',
    modes: [T2I, I2I],
    tier: null,
    cost: 2,
    group: 'creative',
    sortOrder: 90,
    providers: [{ provider: 'fal-ai', endpointId: 'krea-flux-1' }],
    providerAliases: ['krea/flux-1', 'fal/krea-flux-1'],
  },
  {
    slug: 'minimax-image',
    displayName: 'MiniMax Image',
    family: 'minimax-image',
    description:
      'Supplemental general image model for provider diversity and additional style coverage.',
    modes: [T2I, I2I],
    tier: null,
    cost: 1,
    group: 'more',
    sortOrder: 100,
    // No reconciled account backs `minimax/image` → canonical-only, no binding.
    providers: [],
    providerAliases: ['minimax/image'],
  },
];
