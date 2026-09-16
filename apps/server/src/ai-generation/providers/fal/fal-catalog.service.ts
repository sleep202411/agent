import type { ProviderExecutionBinding } from '../../provider-adapter';
import { providerBindingAdmissionEligible } from '../../provider-catalog-eligibility';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/db/db.module';
import {
  applyProviderConcurrencyLimit,
  capacityTiersFromCatalogSnapshot,
  providerCapacityFromRow,
} from '../../provider-capacity';
import { AI_QUEUE_IMAGE, AI_QUEUE_VIDEO } from '../../queue';
import { requiredPlanFromPolicy } from '../../required-plan';
import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiJsonValue,
  AiJobType,
} from '../../types';
import type { AiModelDefinition } from '../../types';
import { FalConfigService } from './fal-config.service';
import type { FalModelRuntimeConfig } from './fal.types';
import { createFalModelConfig, toAiModelDefinition } from './fal-schema.mapper';

interface FalCatalogCache {
  expiresAt: number;
  executionEntries: FalRuntimeEntry[];
  models: AiModelDefinition[];
  runtimeByModelId: Map<string, FalModelRuntimeConfig>;
  runtimeByEndpointId: Map<string, FalModelRuntimeConfig>;
}

@Injectable()
export class FalCatalogService {
  private readonly logger = new Logger(FalCatalogService.name);
  private cache: FalCatalogCache | null = null;
  private cacheRead: Promise<FalCatalogCache> | null = null;

  constructor(
    private readonly configService: FalConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async listModels(): Promise<AiModelDefinition[]> {
    const cache = await this.getCache();
    return cache.models;
  }

  async getModel(modelId: string): Promise<AiModelDefinition | null> {
    const cache = await this.getCache();
    return (
      cache.models.find(
        (model) =>
          model.id === modelId ||
          model.deployment === modelId ||
          `fal/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  async getRuntimeConfig(
    modelId: string,
    options?: { forSubmission?: boolean },
  ): Promise<FalModelRuntimeConfig | null> {
    if (options?.forSubmission && !(await this.getModel(modelId))) return null;
    const cache = await this.getCache();
    return (
      cache.runtimeByModelId.get(modelId) ??
      cache.runtimeByEndpointId.get(modelId) ??
      cache.runtimeByModelId.get(`fal/${modelId}`) ??
      null
    );
  }

  async getExecutionBinding(
    modelId: string,
    endpointId: string,
  ): Promise<ProviderExecutionBinding | null> {
    const model = await this.getModel(modelId);
    if (!model) return null;
    const cache = await this.getCache();
    const entry = cache.executionEntries.find(
      (item) =>
        item.modelId === model.id && item.runtime.endpointId === endpointId,
    );
    return entry ? { deployment: endpointId, ops: entry.ops } : null;
  }

  private async getCache(): Promise<FalCatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    if (this.cacheRead) return this.cacheRead;
    const pending = this.loadCache().finally(() => {
      if (this.cacheRead === pending) this.cacheRead = null;
    });
    this.cacheRead = pending;
    return pending;
  }

  private async loadCache(): Promise<FalCatalogCache> {
    const config = this.configService.config;
    const runtimeByModelId = new Map<string, FalModelRuntimeConfig>();
    const runtimeByEndpointId = new Map<string, FalModelRuntimeConfig>();
    const dbRuntimes = (await this.dbRuntimeConfigs()).sort(
      (a, b) => Number(b.admissionEligible) - Number(a.admissionEligible),
    );

    // Register EVERY active binding's endpoint BEFORE the catalog dedupe so
    // poll/cancel can resolve any endpoint a job was actually submitted to
    // (multi-endpoint models route per mode at submit; the real endpoint is
    // encoded in providerJobId). First entry wins: rows are already in
    // priority/weight/endpointId order.
    for (const entry of dbRuntimes) {
      if (!runtimeByEndpointId.has(entry.runtime.endpointId)) {
        runtimeByEndpointId.set(entry.runtime.endpointId, entry.runtime);
      }
      if (!runtimeByModelId.has(entry.runtime.endpointId)) {
        runtimeByModelId.set(entry.runtime.endpointId, entry.runtime);
      }
      if (!runtimeByModelId.has(`fal/${entry.runtime.endpointId}`)) {
        runtimeByModelId.set(`fal/${entry.runtime.endpointId}`, entry.runtime);
      }
    }

    const runtimeEntries = this.dedupeRuntimeEntries(
      dbRuntimes.filter((entry) => entry.admissionEligible),
    );
    const models = runtimeEntries.map((entry) => {
      const model = {
        ...toAiModelDefinition(entry.runtime),
        id: entry.modelId,
        name: entry.name,
        description: entry.description,
        ops: entry.ops,
      };
      runtimeByModelId.set(model.id, entry.runtime);
      if (!runtimeByModelId.has(model.deployment)) {
        runtimeByModelId.set(model.deployment, entry.runtime);
      }
      return model;
    });

    if (config.enabled && runtimeEntries.length === 0) {
      this.logger.warn(
        'FAL_ENABLED=true but no active fal.ai provider bindings are configured in AI Model Ops.',
      );
    }

    this.cache = {
      executionEntries: dbRuntimes.filter((entry) => entry.admissionEligible),
      expiresAt: Date.now() + config.catalogRefreshMs,
      models,
      runtimeByModelId,
      runtimeByEndpointId,
    };
    return this.cache;
  }

  private async dbRuntimeConfigs(): Promise<FalRuntimeEntry[]> {
    const config = this.configService.config;
    const rows = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        provider: 'fal-ai',
        status: 'active',
        archivedAt: null,
        providerAccount: {
          status: 'active',
          archivedAt: null,
        },
      },
      include: {
        canonicalModel: true,
        providerAccount: true,
        providerEndpoint: true,
      },
      orderBy: [{ priority: 'asc' }, { weight: 'desc' }, { endpointId: 'asc' }],
    });

    // Multi-endpoint models (e.g. seedance: text/image/reference-to-video) split
    // their modes across one binding per mode. The catalog assembles a single
    // entry per model, so advertise the UNION of modes across all of a
    // canonical's active fal bindings — otherwise the UI only sees the primary
    // binding's modes and the model looks unavailable for every other mode.
    const modesByCanonical = new Map<string, Set<AiGenerationMode>>();
    // Per-canonical mode -> endpointId routing map, built from each row's OWN
    // supportedModes. Rows are in priority/weight/endpointId order, so the
    // first binding wins per mode — official-first routing falls out of the
    // binding priorities.
    const modeEndpointsByCanonical = new Map<
      string,
      Partial<Record<AiGenerationMode, string>>
    >();
    const endpointsByCanonical = new Map<string, Set<string>>();
    for (const row of rows) {
      const endpoints =
        endpointsByCanonical.get(row.canonicalModelId) ?? new Set<string>();
      endpoints.add(row.endpointId);
      endpointsByCanonical.set(row.canonicalModelId, endpoints);
      if (!providerBindingAdmissionEligible(row)) continue;
      const set =
        modesByCanonical.get(row.canonicalModelId) ??
        new Set<AiGenerationMode>();
      const modeEndpoints: Partial<Record<AiGenerationMode, string>> =
        modeEndpointsByCanonical.get(row.canonicalModelId) ?? {};
      for (const mode of stringArray(row.supportedModes)) {
        set.add(mode);
        modeEndpoints[mode] ??= row.endpointId;
      }
      modesByCanonical.set(row.canonicalModelId, set);
      modeEndpointsByCanonical.set(row.canonicalModelId, modeEndpoints);
    }

    return rows.map((row) => {
      const generationModes = Array.from(
        modesByCanonical.get(row.canonicalModelId) ?? [],
      );
      const type = row.modality as AiJobType;
      const providerCapacity = providerCapacityFromRow(row.providerEndpoint);
      const canonicalGlobalConcurrency =
        numberFromPolicy(row.canonicalModel.queuePolicy, 'globalConcurrency') ??
        12;
      const runtime = createFalModelConfig({
        endpointId: row.endpointId,
        type,
        name: row.canonicalModel.displayName,
        description:
          row.canonicalModel.description ??
          `${row.displayName ?? row.endpointId} via fal.ai.`,
        generationModes,
        requiredPlan: requiredPlanFromPolicy(
          row.canonicalModel.entitlementPolicy,
        ),
        enabled: config.enabled,
        disabledReason: config.enabled
          ? (row.disabledReason ?? undefined)
          : 'fal.ai provider is not enabled for this environment.',
        queueName: type === 'video' ? AI_QUEUE_VIDEO : AI_QUEUE_IMAGE,
        globalConcurrency: applyProviderConcurrencyLimit(
          canonicalGlobalConcurrency,
          providerCapacity,
        ),
        perUserRunning:
          numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserRunning') ??
          (type === 'video' ? 1 : 2),
        perUserQueued:
          numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserQueued') ??
          10,
        pollDelayMs: config.pollDelayMs,
        billing: billingPolicyFromRow(row),
        parameterPolicy: row.canonicalModel.parameterPolicy as AiJsonValue,
      });
      // Every sibling runtime of a canonical carries the SAME map, so a
      // poll-time lookup via any endpointId routes identically to submit-time.
      runtime.strictModeRouting =
        (endpointsByCanonical.get(row.canonicalModelId)?.size ?? 0) > 1;
      runtime.modeEndpoints = modeEndpointsByCanonical.get(
        row.canonicalModelId,
      );
      return {
        admissionEligible: providerBindingAdmissionEligible(row),
        runtime,
        modelId: row.canonicalModel.slug,
        name: row.canonicalModel.displayName,
        description: row.canonicalModel.description ?? runtime.description,
        endpointId: row.endpointId,
        ops: {
          canonicalModelId: row.canonicalModelId,
          canonicalSlug: row.canonicalModel.slug,
          providerAccountId: row.providerAccountId,
          providerBindingId: row.id,
          providerEndpointId: row.providerEndpointId,
          providerRoutePriority: row.priority,
          providerRouteWeight: row.weight,
          providerCapacity,
          providerCapacityTiers: capacityTiersFromCatalogSnapshot(
            row.providerEndpoint.catalogSnapshot,
          ),
        },
      };
    });
  }

  private dedupeRuntimeEntries(entries: FalRuntimeEntry[]): FalRuntimeEntry[] {
    const byModelId = new Map<string, FalRuntimeEntry>();
    for (const entry of entries) {
      if (!byModelId.has(entry.modelId)) byModelId.set(entry.modelId, entry);
    }
    return Array.from(byModelId.values());
  }
}

type FalRuntimeEntry = {
  admissionEligible: boolean;
  runtime: FalModelRuntimeConfig;
  modelId: string;
  name: string;
  description: string;
  endpointId: string;
  ops: {
    canonicalModelId: string;
    canonicalSlug: string;
    providerAccountId: string;
    providerBindingId: string;
    providerEndpointId: string;
    providerRoutePriority: number;
    providerRouteWeight: number;
  };
};

function stringArray(value: unknown): AiGenerationMode[] {
  return Array.isArray(value)
    ? value.filter((item): item is AiGenerationMode => typeof item === 'string')
    : [];
}

function numberFromPolicy(value: unknown, key: string): number | undefined {
  const record = recordValue(value);
  const raw = record?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function billingPolicyFromRow(row: {
  canonicalModel: { billingPolicy: Prisma.JsonValue };
}): Partial<AiBillingPolicy> {
  const canonical = recordValue(row.canonicalModel.billingPolicy);
  const policy = canonical ?? {};
  const productPricing =
    policy.productPricing &&
    typeof policy.productPricing === 'object' &&
    !Array.isArray(policy.productPricing)
      ? (policy.productPricing as AiBillingPolicy['productPricing'])
      : null;
  if (!productPricing) {
    throw new Error('Canonical model is missing productPricing.');
  }
  return {
    mode:
      policy.mode === 'free' || policy.mode === 'estimate_then_finalize'
        ? policy.mode
        : 'charge',
    unit:
      typeof policy.unit === 'string'
        ? (policy.unit as AiBillingPolicy['unit'])
        : 'compute_point',
    displayCurrency:
      typeof policy.displayCurrency === 'string'
        ? policy.displayCurrency
        : 'COMPUTE_POINTS',
    preflightCost:
      typeof policy.preflightCost === 'number'
        ? policy.preflightCost
        : undefined,
    finalCostSource:
      typeof policy.finalCostSource === 'string'
        ? (policy.finalCostSource as AiBillingPolicy['finalCostSource'])
        : 'product_pricing',
    refundPolicy:
      typeof policy.refundPolicy === 'string'
        ? (policy.refundPolicy as AiBillingPolicy['refundPolicy'])
        : 'refund_on_final_failure',
    productPricing,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
