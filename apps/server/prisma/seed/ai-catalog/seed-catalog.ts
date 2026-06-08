/**
 * Generic, idempotent AI image-catalog seeder.
 *
 * For each declarative model in `image-models.ts`:
 *   1. Build the canonical payload ONCE (defaults merged with overrides) and
 *      upsert `AiCanonicalModel` by `slug` with `{ create: payload, update:
 *      payload }` — no duplicated create/update blocks.
 *   2. For each account-backed provider entry: look up the `AiProviderAccount`
 *      by provider key (skip with a warning if missing), promote it to
 *      `active` so its bindings are runtime-visible, upsert the
 *      `AiProviderEndpoint` (unique on `[providerAccountId, endpointId]`), then
 *      upsert the `AiProviderModelBinding` (same composite unique) shaped to
 *      match `providerBindingDataFromEndpoint` so the fal runtime catalog can
 *      read it.
 *
 * Every write is an upsert on a documented unique key — safe to re-run.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import {
  buildBillingPolicy,
  buildEntitlementPolicy,
  buildMetadata,
  buildOutputPolicy,
  buildQueuePolicy,
  buildUiPolicy,
  OBSERVABILITY_POLICY,
} from './defaults';
import {
  IMAGE_MODELS,
  type ImageModelSeed,
  type ProviderEntry,
} from './image-models';

const SEED_ADMIN_ID: string | null = null; // seed-managed rows have no admin author.

/**
 * Build the canonical-model payload once. Returned shape is used verbatim for
 * both the `create` and `update` branches of the upsert. `archivedAt: null`
 * un-archives a previously deprecated slug if it gets re-promoted.
 */
function buildCanonicalPayload(
  model: ImageModelSeed,
  seededAt: string,
): Prisma.AiCanonicalModelUncheckedCreateInput {
  return {
    slug: model.slug,
    displayName: model.displayName,
    modality: 'image',
    family: model.family,
    generationModes: model.modes as Prisma.InputJsonValue,
    status: 'active',
    description: model.description,
    parameterPolicy: model.parameterPolicy,
    outputPolicy: buildOutputPolicy(model.productPricing),
    entitlementPolicy: buildEntitlementPolicy(model.tier),
    billingPolicy: buildBillingPolicy(model.cost, model.productPricing),
    queuePolicy: buildQueuePolicy(model.tier),
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
 * are derived from the resolved account (never from an alias). `supportedModes`
 * carries the canonical modes so the binding copy is runtime-valid.
 */
function buildEndpointPayload(args: {
  providerAccountId: string;
  provider: string;
  endpointId: string;
  displayName: string;
  modes: string[];
}): Prisma.AiProviderEndpointUncheckedCreateInput {
  const providerInputSchema: Prisma.InputJsonObject = {};
  const providerOutputSchema: Prisma.InputJsonObject = {};
  return {
    providerAccountId: args.providerAccountId,
    provider: args.provider,
    endpointId: args.endpointId,
    displayName: args.displayName,
    modality: 'image',
    status: 'active',
    healthStatus: 'unknown',
    supportedModes: args.modes as Prisma.InputJsonValue,
    providerInputSchema,
    providerOutputSchema,
    createdByAdminId: SEED_ADMIN_ID,
    updatedByAdminId: SEED_ADMIN_ID,
  };
}

/**
 * Build the binding payload once, matching `providerBindingDataFromEndpoint`:
 * provider-facing fields come from the endpoint. Product pricing, user-facing
 * parameter policy, queue policy, and observability stay on the canonical
 * model. Provider request mapping stays in adapter code; retries preserve the
 * submit-time routing snapshot.
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
}): Prisma.AiProviderModelBindingUncheckedCreateInput {
  const { endpoint } = args;
  return {
    providerAccountId: endpoint.providerAccountId,
    providerEndpointId: endpoint.id,
    canonicalModelId: args.canonicalModelId,
    provider: endpoint.provider,
    endpointId: endpoint.endpointId,
    displayName: endpoint.displayName,
    modality: 'image',
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

/** Run the full image-catalog seed. Idempotent. */
export async function seedAiImageCatalog(prisma: PrismaClient): Promise<void> {
  const seededAt = new Date().toISOString();

  const allowedSlugs = IMAGE_MODELS.map((model) => model.slug);
  const allowedProviderEndpointPairs = IMAGE_MODELS.flatMap((model) =>
    model.providers.map((provider) => ({
      provider: provider.provider,
      endpointId: provider.endpointId,
    })),
  );

  // This catalog is deliberately narrow while we validate models one by one.
  // Remove old image ContainerModels and their endpoint bindings instead of
  // keeping stale choices around in admin/runtime state.
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
      modality: 'image',
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
      modality: 'image',
      ...(allowedProviderEndpointWhere
        ? { NOT: allowedProviderEndpointWhere }
        : { endpointId: { not: '' } }),
    },
  });
  const staleCanonicalModels = await prisma.aiCanonicalModel.deleteMany({
    where: {
      modality: 'image',
      slug: { notIn: allowedSlugs },
    },
  });

  // Cache provider-account upserts. The seed owns the initial GPT Image 2
  // provider route graph, so it creates/activates the required account rows
  // instead of depending on application bootstrap to reconcile them first.
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

  for (const model of IMAGE_MODELS) {
    const canonicalPayload = buildCanonicalPayload(model, seededAt);
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
    `[seed] upserted ${summary.length} canonical image model(s); pruned ${staleCanonicalModels.count} stale ContainerModel(s), ${staleEndpoints.count} stale provider endpoint(s), ${staleBindings.count} stale binding(s).`,
  );
}

/**
 * Activate the account, then upsert the endpoint and binding for one provider
 * entry. Account promotion is required: the reconciler leaves accounts `draft`,
 * but the fal runtime only reads bindings whose account is `active`.
 */
async function bindProviderEntry(args: {
  prisma: PrismaClient;
  model: ImageModelSeed;
  canonicalModelId: string;
  account: { id: string; provider: string };
  entry: ProviderEntry;
}): Promise<void> {
  const { prisma, model, canonicalModelId, account, entry } = args;

  // Promote the account so seeded bindings are runtime-visible.
  await prisma.aiProviderAccount.update({
    where: { provider: account.provider },
    data: { status: 'active' },
  });

  const endpointPayload = buildEndpointPayload({
    providerAccountId: account.id,
    provider: account.provider,
    endpointId: entry.endpointId,
    displayName: model.displayName,
    modes: entry.modes ?? model.modes,
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
