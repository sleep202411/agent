import 'dotenv/config';
import { buildPrisma } from '../src/infra/db/db.module';

type ImageModelSeed = {
  slug: string;
  displayName: string;
  family: string;
  description: string;
  generationModes: string[];
  group: string;
  sortOrder: number;
  requiredPlan: string | null;
  preflightCost: number;
  recommended?: boolean;
  providerAliases: string[];
};

const nowIso = () => new Date().toISOString();

const deprecatedGenericSlugs = [
  'nano-banana',
  'gpt-image',
  'seedream',
  'flux',
  'ideogram',
  'recraft',
];

const imageModels: ImageModelSeed[] = [
  {
    slug: 'gpt-image-2',
    displayName: 'GPT Image 2',
    family: 'gpt-image',
    description:
      'OpenAI image generation and editing model for instruction-following, typography, layout, product mockups, and structured visual edits.',
    generationModes: ['text_to_image', 'image_to_image', 'inpainting'],
    group: 'recommended',
    sortOrder: 10,
    requiredPlan: 'vip',
    preflightCost: 4,
    recommended: true,
    providerAliases: ['openai/gpt-image-2', 'fal/gpt-image-2'],
  },
  {
    slug: 'nano-banana-2',
    displayName: 'Nano Banana 2',
    family: 'nano-banana',
    description:
      'Google image model for high-quality general image generation, edits, and visual reference following.',
    generationModes: ['text_to_image', 'image_to_image'],
    group: 'recommended',
    sortOrder: 20,
    requiredPlan: 'vip',
    preflightCost: 3,
    recommended: true,
    providerAliases: ['google/nano-banana-2', 'fal/nano-banana-2'],
  },
  {
    slug: 'seedream-v5',
    displayName: 'Seedream v5',
    family: 'seedream',
    description:
      'ByteDance image model for commercial visuals, portrait work, Chinese prompts, and precise image edits.',
    generationModes: ['text_to_image', 'image_to_image', 'inpainting'],
    group: 'recommended',
    sortOrder: 30,
    requiredPlan: null,
    preflightCost: 2,
    recommended: true,
    providerAliases: ['bytedance/seedream-v5', 'fal/seedream-v5'],
  },
  {
    slug: 'qwen-image',
    displayName: 'Qwen Image',
    family: 'qwen-image',
    description:
      'Alibaba Qwen image model optimized for Chinese text rendering, posters, and Model Studio routing.',
    generationModes: ['text_to_image', 'image_to_image'],
    group: 'recommended',
    sortOrder: 40,
    requiredPlan: null,
    preflightCost: 2,
    recommended: true,
    providerAliases: ['aliyun/qwen-image', 'fal/qwen-image'],
  },
  {
    slug: 'flux-2-max',
    displayName: 'Flux.2 Max',
    family: 'flux',
    description:
      'Black Forest Labs Flux model for photorealistic generation, open ecosystem routing, and cost-flexible provider fallback.',
    generationModes: ['text_to_image', 'image_to_image'],
    group: 'photoreal',
    sortOrder: 50,
    requiredPlan: 'vip',
    preflightCost: 3,
    providerAliases: ['black-forest-labs/flux-2-max', 'fal/flux-2-max'],
  },
  {
    slug: 'midjourney-v7',
    displayName: 'Midjourney V7',
    family: 'midjourney',
    description:
      'Midjourney-style art direction model entry for premium cinematic, illustration, and style-heavy image generation.',
    generationModes: ['text_to_image', 'image_to_image'],
    group: 'premium',
    sortOrder: 60,
    requiredPlan: 'vip',
    preflightCost: 5,
    providerAliases: ['midjourney/v7'],
  },
  {
    slug: 'recraft-v4-1',
    displayName: 'Recraft v4.1',
    family: 'recraft',
    description:
      'Design production model for brand graphics, illustration, icons, marketing assets, and reusable visual systems.',
    generationModes: ['text_to_image', 'image_to_image'],
    group: 'design',
    sortOrder: 70,
    requiredPlan: 'vip',
    preflightCost: 3,
    providerAliases: ['recraft/v4.1', 'fal/recraft/v4.1/text-to-image'],
  },
  {
    slug: 'ideogram-v4',
    displayName: 'Ideogram v4',
    family: 'ideogram',
    description:
      'Design-oriented image model for text-heavy posters, typography, logos, and layout-sensitive visuals.',
    generationModes: ['text_to_image', 'image_to_image'],
    group: 'design',
    sortOrder: 80,
    requiredPlan: 'vip',
    preflightCost: 3,
    providerAliases: ['ideogram/v4', 'fal/ideogram/v4'],
  },
  {
    slug: 'krea-flux-1',
    displayName: 'Krea Flux 1',
    family: 'krea-flux',
    description:
      'Krea Flux entry for fast creative exploration, visual style iteration, and reference-driven concepts.',
    generationModes: ['text_to_image', 'image_to_image'],
    group: 'creative',
    sortOrder: 90,
    requiredPlan: null,
    preflightCost: 2,
    providerAliases: ['krea/flux-1', 'fal/krea-flux-1'],
  },
  {
    slug: 'minimax-image',
    displayName: 'MiniMax Image',
    family: 'minimax-image',
    description:
      'Supplemental general image model for provider diversity and additional style coverage.',
    generationModes: ['text_to_image', 'image_to_image'],
    group: 'more',
    sortOrder: 100,
    requiredPlan: null,
    preflightCost: 1,
    providerAliases: ['minimax/image'],
  },
];

async function main() {
  const prisma = buildPrisma();
  await prisma.$connect();
  try {
    const archivedAt = new Date();
    await prisma.aiCanonicalModel.updateMany({
      where: {
        modality: 'image',
        slug: { in: deprecatedGenericSlugs },
        archivedAt: null,
      },
      data: {
        status: 'archived',
        visibility: 'hidden',
        archivedAt,
      },
    });

    const results = [];
    for (const model of imageModels) {
      const item = await prisma.aiCanonicalModel.upsert({
        where: { slug: model.slug },
        create: {
          slug: model.slug,
          displayName: model.displayName,
          modality: 'image',
          family: model.family,
          generationModes: model.generationModes,
          visibility: 'direct',
          status: 'active',
          description: model.description,
          parameterPolicy: {
            parameterMode: 'provider_intersection',
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
            defaultVariations: 4,
            variationOptions: [1, 2, 3, 4],
            defaultResolution: '1K',
            resolutionOptions: ['1K', '2K', '4K'],
          },
          outputPolicy: {
            outputTypes: ['image'],
            maxOutputs: 4,
            storeOriginalProviderOutput: true,
          },
          entitlementPolicy: {
            requiredPlan: model.requiredPlan,
            freeUserVisible: true,
            providerSelectionPlan: 'vip',
          },
          billingPolicy: {
            mode: 'charge',
            unit: 'compute_point',
            displayCurrency: 'COMPUTE_POINTS',
            preflightCost: model.preflightCost,
            finalCostSource: 'provider_binding',
            refundPolicy: 'refund_on_final_failure',
          },
          queuePolicy: {
            queueName: 'ai-image-generation',
            globalConcurrency: 12,
            perUserRunning: model.requiredPlan ? 2 : 1,
            perUserQueued: model.requiredPlan ? 12 : 8,
            priority: model.requiredPlan ? 10 : 0,
            maxProviderRuntimeSeconds: 600,
          },
          uiPolicy: {
            group: model.group,
            recommended: model.recommended ?? false,
            sortOrder: model.sortOrder,
            advancedVisible: true,
            showProviderName: false,
            showCostEstimate: true,
            showQueueEstimate: true,
          },
          observabilityPolicy: {
            traceInputSnapshot: true,
            traceProviderRequest: true,
            traceProviderResponse: true,
            redactInputFields: [],
            alertOnFailureRate: true,
            alertOnQueueWaitSeconds: 120,
          },
          metadata: {
            managedBy: 'local-seed',
            seedName: 'ai-image-canonical-models',
            seededAt: nowIso(),
            providerAliases: model.providerAliases,
            displayGroup: model.group,
            explicitVersion: true,
          },
        },
        update: {
          displayName: model.displayName,
          modality: 'image',
          family: model.family,
          generationModes: model.generationModes,
          visibility: 'direct',
          status: 'active',
          description: model.description,
          parameterPolicy: {
            parameterMode: 'provider_intersection',
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
            defaultVariations: 4,
            variationOptions: [1, 2, 3, 4],
            defaultResolution: '1K',
            resolutionOptions: ['1K', '2K', '4K'],
          },
          outputPolicy: {
            outputTypes: ['image'],
            maxOutputs: 4,
            storeOriginalProviderOutput: true,
          },
          entitlementPolicy: {
            requiredPlan: model.requiredPlan,
            freeUserVisible: true,
            providerSelectionPlan: 'vip',
          },
          billingPolicy: {
            mode: 'charge',
            unit: 'compute_point',
            displayCurrency: 'COMPUTE_POINTS',
            preflightCost: model.preflightCost,
            finalCostSource: 'provider_binding',
            refundPolicy: 'refund_on_final_failure',
          },
          queuePolicy: {
            queueName: 'ai-image-generation',
            globalConcurrency: 12,
            perUserRunning: model.requiredPlan ? 2 : 1,
            perUserQueued: model.requiredPlan ? 12 : 8,
            priority: model.requiredPlan ? 10 : 0,
            maxProviderRuntimeSeconds: 600,
          },
          uiPolicy: {
            group: model.group,
            recommended: model.recommended ?? false,
            sortOrder: model.sortOrder,
            advancedVisible: true,
            showProviderName: false,
            showCostEstimate: true,
            showQueueEstimate: true,
          },
          observabilityPolicy: {
            traceInputSnapshot: true,
            traceProviderRequest: true,
            traceProviderResponse: true,
            redactInputFields: [],
            alertOnFailureRate: true,
            alertOnQueueWaitSeconds: 120,
          },
          metadata: {
            managedBy: 'local-seed',
            seedName: 'ai-image-canonical-models',
            seededAt: nowIso(),
            providerAliases: model.providerAliases,
            displayGroup: model.group,
            explicitVersion: true,
          },
          archivedAt: null,
        },
        select: {
          slug: true,
          displayName: true,
          status: true,
          visibility: true,
          generationModes: true,
          billingPolicy: true,
          entitlementPolicy: true,
        },
      });
      results.push(item);
    }

    console.table(
      results.map((item) => ({
        slug: item.slug,
        displayName: item.displayName,
        status: item.status,
        visibility: item.visibility,
        generationModes: Array.isArray(item.generationModes)
          ? item.generationModes.join(', ')
          : '',
        billing: JSON.stringify(item.billingPolicy),
        entitlement: JSON.stringify(item.entitlementPolicy),
      })),
    );
    console.log(`Seeded ${results.length} explicit image canonical models.`);
    console.log(
      `Archived ${deprecatedGenericSlugs.length} generic model slugs.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
