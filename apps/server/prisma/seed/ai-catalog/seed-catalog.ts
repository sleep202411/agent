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
import { createHash } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import {
  buildBillingPolicy,
  buildEntitlementPolicy,
  buildMetadata,
  buildQueuePolicy,
  buildUiPolicy,
  OBSERVABILITY_POLICY,
  OUTPUT_POLICY,
  PARAMETER_POLICY,
} from './defaults';
import {
  DEPRECATED_GENERIC_SLUGS,
  IMAGE_MODELS,
  type ImageModelSeed,
  type ProviderEntry,
} from './image-models';

const SEED_ADMIN_ID: string | null = null; // seed-managed rows have no admin author.

/** Mirror of `ai-model-ops.service.ts:hashJson` — sha256 hex sliced to 40. */
function hashJson(value: unknown): string {
  return createHash('sha256')
    .update(stableJson(value))
    .digest('hex')
    .slice(0, 40);
}

/** Mirror of `ai-model-ops.service.ts:stableJson` — order-stable serialization. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

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
    visibility: 'direct',
    status: 'active',
    description: model.description,
    parameterPolicy: PARAMETER_POLICY,
    outputPolicy: OUTPUT_POLICY,
    entitlementPolicy: buildEntitlementPolicy(model.tier),
    billingPolicy: buildBillingPolicy(model.cost),
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
  providerPricing: Prisma.InputJsonObject;
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
    providerPricing: args.providerPricing,
    schemaHash: hashJson({
      input: providerInputSchema,
      output: providerOutputSchema,
    }),
    pricingHash: hashJson(args.providerPricing),
    createdByAdminId: SEED_ADMIN_ID,
    updatedByAdminId: SEED_ADMIN_ID,
  };
}

/**
 * Build the binding payload once, matching `providerBindingDataFromEndpoint`:
 * provider-facing fields come from the endpoint; pricing/queue policy is the
 * runtime-read input. `pricingPolicy` mirrors the canonical billing (so
 * `billingPolicyFromRow` resolves a valid `compute_point` policy) and
 * `queuePolicy` mirrors the canonical queue caps.
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
    providerPricing: Prisma.JsonValue;
    catalogSnapshot: Prisma.JsonValue;
    documentation: Prisma.JsonValue;
    lastSyncedAt: Date | null;
  };
  canonicalModelId: string;
  priority: number;
  weight: number;
  pricingPolicy: Prisma.InputJsonObject;
  queuePolicy: Prisma.InputJsonObject;
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
    providerPricing: endpoint.providerPricing as Prisma.InputJsonValue,
    pricingPolicy: args.pricingPolicy,
    queuePolicy: args.queuePolicy,
    catalogSnapshot: endpoint.catalogSnapshot as Prisma.InputJsonValue,
    documentation: endpoint.documentation as Prisma.InputJsonValue,
    disabledReason: null,
    lastSyncedAt: endpoint.lastSyncedAt,
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

  // 1. Archive deprecated generic slugs before promoting explicit versions.
  const archived = await prisma.aiCanonicalModel.updateMany({
    where: {
      modality: 'image',
      slug: { in: DEPRECATED_GENERIC_SLUGS },
      archivedAt: null,
    },
    data: { status: 'archived', visibility: 'hidden', archivedAt: new Date() },
  });

  // Cache provider-account lookups so a missing-account warning fires once.
  const accountCache = new Map<
    string,
    { id: string; provider: string } | null
  >();
  const warnedProviders = new Set<string>();

  const resolveAccount = async (
    provider: string,
  ): Promise<{ id: string; provider: string } | null> => {
    if (accountCache.has(provider)) return accountCache.get(provider) ?? null;
    const account = await prisma.aiProviderAccount.findFirst({
      where: { provider, archivedAt: null },
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
      if (!account) {
        if (!warnedProviders.has(entry.provider)) {
          warnedProviders.add(entry.provider);
          console.warn(
            `[seed] no reconciled AiProviderAccount for provider "${entry.provider}" — skipping endpoint/binding (canonical-only).`,
          );
        }
        continue;
      }

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
    `[seed] upserted ${summary.length} canonical image model(s); archived ${archived.count} deprecated generic slug(s).`,
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

  const providerPricing: Prisma.InputJsonObject = {
    unit: 'compute_point',
    preflightCost: model.cost,
  };

  const endpointPayload = buildEndpointPayload({
    providerAccountId: account.id,
    provider: account.provider,
    endpointId: entry.endpointId,
    displayName: model.displayName,
    modes: model.modes,
    providerPricing,
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
      providerPricing: true,
      catalogSnapshot: true,
      documentation: true,
      lastSyncedAt: true,
    },
  });

  const pricingPolicy: Prisma.InputJsonObject = {
    mode: 'charge',
    unit: 'compute_point',
    displayCurrency: 'COMPUTE_POINTS',
    preflightCost: model.cost,
    finalCostSource: 'provider_binding',
    refundPolicy: 'refund_on_final_failure',
  };
  const queuePolicy = buildQueuePolicy(model.tier);

  const bindingPayload = buildBindingPayload({
    endpoint,
    canonicalModelId,
    priority: entry.priority ?? 100,
    weight: entry.weight ?? 100,
    pricingPolicy,
    queuePolicy,
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
