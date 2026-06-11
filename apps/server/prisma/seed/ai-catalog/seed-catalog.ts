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
  VIDEO_QUEUE_NAME,
} from './defaults';
import {
  IMAGE_MODELS,
  type ImageModelSeed,
  type ProviderEntry,
} from './image-models';
import { VIDEO_MODELS } from './video-models';

const SEED_ADMIN_ID: string | null = null; // seed-managed rows have no admin author.

type OutputType = 'image' | 'video';

/** Per-modality knobs that differ between the image and video catalogs. */
interface ModalityConfig {
  modality: AiJobType;
  outputType: OutputType;
  models: ImageModelSeed[];
  /** Overrides forwarded to `buildQueuePolicy`. */
  queueOverrides: Parameters<typeof buildQueuePolicy>[1];
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
  queueOverrides: {
    queueName: VIDEO_QUEUE_NAME,
    globalConcurrency: 4,
    perUserRunning: 1,
    maxProviderRuntimeSeconds: 2700,
  },
  label: 'video',
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
    generationModes: model.modes as Prisma.InputJsonValue,
    status: 'active',
    description: model.description,
    parameterPolicy: model.parameterPolicy,
    outputPolicy: buildOutputPolicy(model.productPricing, cfg.outputType),
    entitlementPolicy: buildEntitlementPolicy(model.tier),
    billingPolicy: buildBillingPolicy(model.cost, model.productPricing),
    queuePolicy: buildQueuePolicy(model.tier, cfg.queueOverrides),
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
  tier: string;
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

  const accountCache = new Map<string, { id: string; provider: string }>();
  const resolveAccount = async (
    provider: string,
  ): Promise<{ id: string; provider: string }> => {
    const cached = accountCache.get(provider);
    if (cached) return cached;
    const account = await prisma.aiProviderAccount.upsert({
      where: { provider },
      create: { provider, status: 'active' },
      update: { status: 'active', archivedAt: null },
      select: { id: true, provider: true },
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
      tier: model.tier ?? 'free',
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

/**
 * Activate the account, then upsert the endpoint and binding for one provider
 * entry. Account promotion is required: the reconciler leaves accounts `draft`,
 * but the runtime only reads bindings whose account is `active`.
 */
async function bindProviderEntry(args: {
  prisma: PrismaClient;
  model: ImageModelSeed;
  canonicalModelId: string;
  account: { id: string; provider: string };
  entry: ProviderEntry;
  modality: AiJobType;
}): Promise<void> {
  const { prisma, model, canonicalModelId, account, entry, modality } = args;

  await prisma.aiProviderAccount.update({
    where: { provider: account.provider },
    data: { status: 'active' },
  });

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
