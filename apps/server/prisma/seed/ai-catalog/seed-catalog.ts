/**
 * Generic, idempotent AI catalog seeder (image + video).
 *
 * For each declarative model in its modality list (`image-models.ts` /
 * `video-models.ts`):
 *   1. Build the canonical payload ONCE (defaults merged with overrides) and
 *      upsert `AiCanonicalModel` by `slug` with `{ create, update }` — no
 *      duplicated create/update blocks.
 *   2. For each account-backed provider entry: look up the `AiProviderAccount`
 *      by provider key, promote it to `active`, upsert the `AiProviderEndpoint`
 *      (unique on `[providerAccountId, endpointId]`), then upsert the
 *      `AiProviderModelBinding` (same composite unique).
 *
 * Every write is an upsert on a documented unique key — safe to re-run. Stale
 * rows for the same modality (not in the current list) are pruned.
 */
import type { AiJobType, Prisma, PrismaClient } from '@prisma/client';

import {
  buildBillingPolicy,
  buildEntitlementPolicy,
  buildMetadata,
  buildOutputPolicy,
  buildQueuePolicy,
  buildUiPolicy,
  OBSERVABILITY_POLICY,
  AUDIO_QUEUE_NAME,
  VIDEO_QUEUE_NAME,
} from './defaults';
import {
  IMAGE_MODELS,
  type ImageModelSeed,
  type ProviderEntry,
} from './image-models';
import { VIDEO_MODELS } from './video-models';
import { AUDIO_MODELS } from './audio-models';

const SEED_ADMIN_ID: string | null = null; // seed-managed rows have no admin author.

type OutputType = 'image' | 'video' | 'audio';

/** Per-modality knobs that differ between the image and video catalogs. */
interface ModalityConfig {
  modality: AiJobType;
  outputType: OutputType;
  models: ImageModelSeed[];
  /** Overrides forwarded to `buildQueuePolicy`. */
  queueOverrides: NonNullable<Parameters<typeof buildQueuePolicy>[0]>;
  label: string;
}

const IMAGE_CONFIG: ModalityConfig = {
  modality: 'image',
  outputType: 'image',
  models: IMAGE_MODELS,
  queueOverrides: {},
  label: 'image',
};

const VIDEO_CONFIG: ModalityConfig = {
  modality: 'video',
  outputType: 'video',
  models: VIDEO_MODELS,
  // Video capacity, raised from globalConcurrency 4 / perUserRunning 1 on the
  // evidence in 5,689 jobs: per-user concurrency peaked at exactly 1 and
  // platform concurrency on the busiest model at exactly 4 — both sat ON their
  // ceilings, so the ceilings were the constraint rather than demand. Against
  // that, only 6 of 818 failures carried a provider 429, and none of the
  // BytePlus/Bailian endpoints declares a capacity limit at all, so there is
  // room. 3 of 8 keeps one user off more than half the pool while finally
  // letting a plan upgrade be felt — at 1, `team`'s 28 concurrent jobs were
  // indistinguishable from the free tier.
  queueOverrides: {
    queueName: VIDEO_QUEUE_NAME,
    globalConcurrency: 8,
    perUserRunning: 3,
    maxProviderRuntimeSeconds: 2700,
  },
  label: 'video',
};

const AUDIO_CONFIG: ModalityConfig = {
  modality: 'audio',
  outputType: 'audio',
  models: AUDIO_MODELS,
  queueOverrides: {
    queueName: AUDIO_QUEUE_NAME,
    globalConcurrency: 8,
    perUserRunning: 4,
    maxProviderRuntimeSeconds: 300,
  },
  label: 'audio',
};

/**
 * Build the canonical-model payload once. Returned shape is used verbatim for
 * both the `create` and `update` branches of the upsert. `archivedAt: null`
 * un-archives a previously deprecated slug if it gets re-promoted.
 */
function buildCanonicalPayload(
  model: ImageModelSeed,
  seededAt: string,
  cfg: ModalityConfig,
): Prisma.AiCanonicalModelUncheckedCreateInput {
  return {
    slug: model.slug,
    displayName: model.displayName,
    modality: cfg.modality,
    family: model.family,
    vendor: model.vendor,
    generationModes: model.modes as Prisma.InputJsonValue,
    status: 'active',
    description: model.description,
    parameterPolicy: model.parameterPolicy,
    outputPolicy: buildOutputPolicy(model.productPricing, cfg.outputType),
    entitlementPolicy: buildEntitlementPolicy(model.requiredPlan),
    billingPolicy: buildBillingPolicy(model.cost, model.productPricing),
    // Capacity, NOT entitlement. These two used to share `model.tier`: the
    // per-user caps were `gated ? 2 : 1` off the very same value that decided
    // who may call the model. So "make this model free" also halved its
    // concurrency, "give it more concurrency" also paywalled it, and a
    // migration that merely re-mapped a legacy plan name took the entire
    // catalogue offline. Who may call a model and how much of it one user may
    // occupy are unrelated questions; they now have unrelated inputs.
    queuePolicy: buildQueuePolicy(cfg.queueOverrides),
    uiPolicy: buildUiPolicy({
      group: model.group,
      recommended: model.recommended ?? false,
      sortOrder: model.sortOrder,
    }),
    observabilityPolicy: OBSERVABILITY_POLICY,
    metadata: buildMetadata({
      providerAliases: model.providerAliases,
      group: model.group,
      seededAt,
    }),
    archivedAt: null,
  };
}

/**
 * Build the provider-endpoint payload once. `provider` and `providerAccountId`
 * are derived from the resolved account (never from an alias).
 */
function buildEndpointPayload(args: {
  providerAccountId: string;
  provider: string;
  entry: ProviderEntry;
  displayName: string;
  modes: string[];
  modality: AiJobType;
}): Prisma.AiProviderEndpointUncheckedCreateInput {
  const providerInputSchema: Prisma.InputJsonObject =
    args.entry.providerInputSchema ?? {};
  const providerOutputSchema: Prisma.InputJsonObject =
    args.entry.providerOutputSchema ?? {};
  return {
    providerAccountId: args.providerAccountId,
    provider: args.provider,
    endpointId: args.entry.endpointId,
    displayName: args.entry.displayName ?? args.displayName,
    modality: args.modality,
    status: 'active',
    healthStatus: 'unknown',
    supportedModes: args.modes as Prisma.InputJsonValue,
    providerInputSchema,
    providerOutputSchema,
    maxConcurrentRequests: args.entry.maxConcurrentRequests ?? null,
    maxRequestsPerMinute: args.entry.maxRequestsPerMinute ?? null,
    requestTimeoutSeconds: args.entry.requestTimeoutSeconds ?? null,
    cooldownSeconds: args.entry.cooldownSeconds ?? null,
    failureThreshold: args.entry.failureThreshold ?? null,
    catalogSnapshot: args.entry.catalogSnapshot ?? {},
    createdByAdminId: SEED_ADMIN_ID,
    updatedByAdminId: SEED_ADMIN_ID,
  };
}

/**
 * Build the binding payload once, matching `providerBindingDataFromEndpoint`:
 * provider-facing fields come from the endpoint.
 */
function buildBindingPayload(args: {
  endpoint: {
    id: string;
    providerAccountId: string;
    provider: string;
    endpointId: string;
    displayName: string | null;
    supportedModes: Prisma.JsonValue;
    providerInputSchema: Prisma.JsonValue;
    providerOutputSchema: Prisma.JsonValue;
    catalogSnapshot: Prisma.JsonValue;
  };
  canonicalModelId: string;
  priority: number;
  weight: number;
  modality: AiJobType;
}): Prisma.AiProviderModelBindingUncheckedCreateInput {
  const { endpoint } = args;
  return {
    providerAccountId: endpoint.providerAccountId,
    providerEndpointId: endpoint.id,
    canonicalModelId: args.canonicalModelId,
    provider: endpoint.provider,
    endpointId: endpoint.endpointId,
    displayName: endpoint.displayName,
    modality: args.modality,
    status: 'active',
    priority: args.priority,
    weight: args.weight,
    supportedModes: endpoint.supportedModes as Prisma.InputJsonValue,
    inputSchema: endpoint.providerInputSchema as Prisma.InputJsonValue,
    outputSchema: endpoint.providerOutputSchema as Prisma.InputJsonValue,
    providerInputSchema: endpoint.providerInputSchema as Prisma.InputJsonValue,
    providerOutputSchema:
      endpoint.providerOutputSchema as Prisma.InputJsonValue,
    catalogSnapshot: endpoint.catalogSnapshot as Prisma.InputJsonValue,
    disabledReason: null,
    createdByAdminId: SEED_ADMIN_ID,
    updatedByAdminId: SEED_ADMIN_ID,
  };
}

interface SeedSummaryRow {
  slug: string;
  status: string;
  requiredPlan: string;
  cost: number;
  providers: string;
  bindings: number;
}

/** Run one modality's catalog seed. Idempotent. */
async function seedModalityCatalog(
  prisma: PrismaClient,
  cfg: ModalityConfig,
): Promise<void> {
  const seededAt = new Date().toISOString();

  const allowedSlugs = cfg.models.map((model) => model.slug);
  const allowedProviderEndpointPairs = cfg.models.flatMap((model) =>
    model.providers.map((provider) => ({
      provider: provider.provider,
      endpointId: provider.endpointId,
    })),
  );

  // Deliberately narrow while validating models one by one — prune stale rows
  // of the same modality instead of leaving them in admin/runtime state.
  const allowedProviderEndpointWhere =
    allowedProviderEndpointPairs.length > 0
      ? {
          OR: allowedProviderEndpointPairs.map((pair) => ({
            provider: pair.provider,
            endpointId: pair.endpointId,
          })),
        }
      : undefined;
  const staleBindings = await prisma.aiProviderModelBinding.deleteMany({
    where: {
      modality: cfg.modality,
      OR: [
        { canonicalModel: { slug: { notIn: allowedSlugs } } },
        allowedProviderEndpointWhere
          ? { NOT: allowedProviderEndpointWhere }
          : { endpointId: { not: '' } },
      ],
    },
  });
  const staleEndpoints = await prisma.aiProviderEndpoint.deleteMany({
    where: {
      modality: cfg.modality,
      ...(allowedProviderEndpointWhere
        ? { NOT: allowedProviderEndpointWhere }
        : { endpointId: { not: '' } }),
    },
  });
  const staleCanonicalModels = await prisma.aiCanonicalModel.deleteMany({
    where: {
      modality: cfg.modality,
      slug: { notIn: allowedSlugs },
    },
  });

  const accountCache = new Map<
    string,
    { id: string; provider: string; status: string }
  >();
  const resolveAccount = async (
    provider: string,
  ): Promise<{ id: string; provider: string; status: string }> => {
    const cached = accountCache.get(provider);
    if (cached) return cached;
    // Never re-activate ops-disabled accounts. Draft → active only inside
    // bindProviderEntry when binding a seed entry.
    const account = await prisma.aiProviderAccount.upsert({
      where: { provider },
      create: { provider, status: 'active' },
      update: {},
      select: { id: true, provider: true, status: true },
    });
    accountCache.set(provider, account);
    return account;
  };

  const summary: SeedSummaryRow[] = [];

  for (const model of cfg.models) {
    const canonicalPayload = buildCanonicalPayload(model, seededAt, cfg);
    const canonical = await prisma.aiCanonicalModel.upsert({
      where: { slug: model.slug },
      create: canonicalPayload,
      update: canonicalPayload,
      select: { id: true, slug: true, status: true },
    });

    let bindingCount = 0;
    const boundProviders: string[] = [];

    for (const entry of model.providers) {
      const account = await resolveAccount(entry.provider);
      await bindProviderEntry({
        prisma,
        model,
        canonicalModelId: canonical.id,
        account,
        entry,
        modality: cfg.modality,
      });
      bindingCount += 1;
      boundProviders.push(`${entry.provider}:${entry.endpointId}`);
    }

    summary.push({
      slug: canonical.slug,
      status: canonical.status,
      requiredPlan: model.requiredPlan ?? 'open',
      cost: model.cost,
      providers: boundProviders.join(', ') || '(canonical-only)',
      bindings: bindingCount,
    });
  }

  console.table(summary);
  console.log(
    `[seed:${cfg.label}] upserted ${summary.length} canonical ${cfg.label} model(s); pruned ${staleCanonicalModels.count} stale ContainerModel(s), ${staleEndpoints.count} stale endpoint(s), ${staleBindings.count} stale binding(s).`,
  );
}

/** Run the full image-catalog seed. Idempotent. */
export async function seedAiImageCatalog(prisma: PrismaClient): Promise<void> {
  await seedModalityCatalog(prisma, IMAGE_CONFIG);
}

/** Run the full video-catalog seed. Idempotent. */
export async function seedAiVideoCatalog(prisma: PrismaClient): Promise<void> {
  await seedModalityCatalog(prisma, VIDEO_CONFIG);
}

/** Run the full audio-catalog seed. Idempotent. */
export async function seedAiAudioCatalog(prisma: PrismaClient): Promise<void> {
  await seedModalityCatalog(prisma, AUDIO_CONFIG);
}

/**
 * Surgical upsert of a single video canonical + its provider bindings.
 * - Does NOT prune any rows
 * - Does NOT touch other slugs / modalities
 * Safe for production "add one model" when used deliberately.
 */
export async function seedSingleVideoModel(
  prisma: PrismaClient,
  slug: string,
): Promise<{
  slug: string;
  status: string;
  providers: string[];
  createdCanonical: boolean;
}> {
  return seedSingleCanonicalModel(prisma, slug, VIDEO_MODELS, VIDEO_CONFIG);
}

/**
 * Surgical upsert of a single audio canonical + its provider bindings.
 * Same production-safety contract as {@link seedSingleVideoModel}.
 */
/** Serialisable plan for an in-cluster pg apply (laptop cannot reach prod PG). */
export function planSingleModelSeed(slug: string): {
  slug: string;
  modality: AiJobType;
  canonical: Prisma.AiCanonicalModelUncheckedCreateInput;
  providers: Array<{
    provider: string;
    endpoint: Omit<
      Prisma.AiProviderEndpointUncheckedCreateInput,
      'providerAccountId'
    >;
    binding: Omit<
      Prisma.AiProviderModelBindingUncheckedCreateInput,
      'providerAccountId' | 'providerEndpointId' | 'canonicalModelId'
    >;
  }>;
} {
  const video = VIDEO_MODELS.find((entry) => entry.slug === slug);
  const audio = AUDIO_MODELS.find((entry) => entry.slug === slug);
  const model = video ?? audio;
  const cfg = video ? VIDEO_CONFIG : audio ? AUDIO_CONFIG : null;
  if (!model || !cfg) {
    throw new Error(`Unknown catalog slug "${slug}".`);
  }
  const seededAt = new Date().toISOString();
  const canonical = buildCanonicalPayload(model, seededAt, cfg);
  return {
    slug: model.slug,
    modality: cfg.modality,
    canonical,
    providers: model.providers.map((entry) => ({
      provider: entry.provider,
      endpoint: buildEndpointPayload({
        providerAccountId: 'pending',
        provider: entry.provider,
        entry,
        displayName: model.displayName,
        modes: entry.modes ?? model.modes,
        modality: cfg.modality,
      }),
      binding: buildBindingPayload({
        endpoint: {
          id: 'pending',
          providerAccountId: 'pending',
          provider: entry.provider,
          endpointId: entry.endpointId,
          displayName: entry.displayName ?? model.displayName,
          supportedModes: entry.modes ?? model.modes,
          providerInputSchema: entry.providerInputSchema ?? {},
          providerOutputSchema: entry.providerOutputSchema ?? {},
          catalogSnapshot: entry.catalogSnapshot ?? {},
        },
        canonicalModelId: 'pending',
        priority: entry.priority ?? 100,
        weight: entry.weight ?? 100,
        modality: cfg.modality,
      }),
    })),
  };
}

export async function seedSingleAudioModel(
  prisma: PrismaClient,
  slug: string,
): Promise<{
  slug: string;
  status: string;
  providers: string[];
  createdCanonical: boolean;
}> {
  return seedSingleCanonicalModel(prisma, slug, AUDIO_MODELS, AUDIO_CONFIG);
}

async function seedSingleCanonicalModel(
  prisma: PrismaClient,
  slug: string,
  models: ImageModelSeed[],
  cfg: ModalityConfig,
): Promise<{
  slug: string;
  status: string;
  providers: string[];
  createdCanonical: boolean;
}> {
  const model = models.find((entry) => entry.slug === slug);
  if (!model) {
    throw new Error(
      `Unknown ${cfg.label} model slug "${slug}". Not present in the ${cfg.label} catalog.`,
    );
  }

  const seededAt = new Date().toISOString();
  const existing = await prisma.aiCanonicalModel.findUnique({
    where: { slug: model.slug },
    select: { id: true },
  });

  const canonicalPayload = buildCanonicalPayload(model, seededAt, cfg);
  const canonical = await prisma.aiCanonicalModel.upsert({
    where: { slug: model.slug },
    create: canonicalPayload,
    update: canonicalPayload,
    select: { id: true, slug: true, status: true },
  });

  const providers: string[] = [];
  for (const entry of model.providers) {
    // Never force a disabled/draft account back to active — ops may have
    // deliberately deactivated the provider. Create only if missing; leave
    // existing status untouched. bindProviderEntry will no-op-activate only
    // when the account is draft (never active if ops set disabled).
    const account = await prisma.aiProviderAccount.upsert({
      where: { provider: entry.provider },
      create: { provider: entry.provider, status: 'active' },
      update: {},
      select: { id: true, provider: true, status: true },
    });
    await bindProviderEntry({
      prisma,
      model,
      canonicalModelId: canonical.id,
      account,
      entry,
      modality: cfg.modality,
    });
    providers.push(`${entry.provider}:${entry.endpointId}`);
  }

  return {
    slug: canonical.slug,
    status: canonical.status,
    providers,
    createdCanonical: !existing,
  };
}

/**
 * Upsert endpoint + binding for one provider entry.
 * Only promotes **draft** accounts to active (reconciler default). Never
 * re-activates an ops-disabled / archived account.
 */
async function bindProviderEntry(args: {
  prisma: PrismaClient;
  model: ImageModelSeed;
  canonicalModelId: string;
  account: { id: string; provider: string; status?: string };
  entry: ProviderEntry;
  modality: AiJobType;
}): Promise<void> {
  const { prisma, model, canonicalModelId, account, entry, modality } = args;

  const current =
    account.status ??
    (
      await prisma.aiProviderAccount.findUnique({
        where: { provider: account.provider },
        select: { status: true },
      })
    )?.status;
  if (current === 'draft') {
    await prisma.aiProviderAccount.update({
      where: { provider: account.provider },
      data: { status: 'active' },
    });
  }

  const endpointPayload = buildEndpointPayload({
    providerAccountId: account.id,
    provider: account.provider,
    entry,
    displayName: model.displayName,
    modes: entry.modes ?? model.modes,
    modality,
  });

  const endpoint = await prisma.aiProviderEndpoint.upsert({
    where: {
      providerAccountId_endpointId: {
        providerAccountId: account.id,
        endpointId: entry.endpointId,
      },
    },
    create: endpointPayload,
    update: endpointPayload,
    select: {
      id: true,
      providerAccountId: true,
      provider: true,
      endpointId: true,
      displayName: true,
      supportedModes: true,
      providerInputSchema: true,
      providerOutputSchema: true,
      catalogSnapshot: true,
    },
  });

  const bindingPayload = buildBindingPayload({
    endpoint,
    canonicalModelId,
    priority: entry.priority ?? 100,
    weight: entry.weight ?? 100,
    modality,
  });

  await prisma.aiProviderModelBinding.upsert({
    where: {
      providerAccountId_endpointId: {
        providerAccountId: account.id,
        endpointId: entry.endpointId,
      },
    },
    create: bindingPayload,
    update: bindingPayload,
  });
}
