import { providerBindingAdmissionEligible } from '../../provider-catalog-eligibility';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/db/db.module';
import {
  applyProviderConcurrencyLimit,
  providerCapacityFromRow,
} from '../../provider-capacity';
import { AI_QUEUE_IMAGE, AI_QUEUE_VIDEO } from '../../queue';
import { requiredPlanFromPolicy } from '../../required-plan';
import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiJobType,
  AiJsonValue,
} from '../../types';
import type { AiModelDefinition } from '../../types';
import { AgnesConfigService } from './agnes-config.service';
import {
  createAgnesRuntimeConfig,
  toAgnesModelDefinition,
  type AgnesRuntimeConfig,
} from './agnes-runtime';

interface AgnesCatalogCache {
  expiresAt: number;
  models: AiModelDefinition[];
  lookupModels: AiModelDefinition[];
  runtimeByModelId: Map<string, AgnesRuntimeConfig>;
  runtimeByEndpointId: Map<string, AgnesRuntimeConfig>;
}

@Injectable()
export class AgnesCatalogService {
  private readonly logger = new Logger(AgnesCatalogService.name);
  private cache: AgnesCatalogCache | null = null;
  private cacheRead: Promise<AgnesCatalogCache> | null = null;

  constructor(
    private readonly configService: AgnesConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async listModels(): Promise<AiModelDefinition[]> {
    const cache = await this.getCache();
    return cache.models;
  }

  async getModel(modelId: string): Promise<AiModelDefinition | null> {
    const cache = await this.getCache();
    return (
      cache.lookupModels.find(
        (model) =>
          model.id === modelId ||
          model.deployment === modelId ||
          `agnes/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  async getRuntimeConfig(
    modelId: string,
    options?: { forSubmission?: boolean },
  ): Promise<AgnesRuntimeConfig | null> {
    if (options?.forSubmission && !(await this.getModel(modelId))) return null;
    const cache = await this.getCache();
    return (
      cache.runtimeByModelId.get(modelId) ??
      cache.runtimeByEndpointId.get(modelId) ??
      cache.runtimeByModelId.get(`agnes/${modelId}`) ??
      null
    );
  }

  private async getCache(): Promise<AgnesCatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    if (this.cacheRead) return this.cacheRead;
    const pending = this.loadCache().finally(() => {
      if (this.cacheRead === pending) this.cacheRead = null;
    });
    this.cacheRead = pending;
    return pending;
  }

  private async loadCache(): Promise<AgnesCatalogCache> {
    const config = this.configService.config;
    const runtimeByModelId = new Map<string, AgnesRuntimeConfig>();
    const runtimeByEndpointId = new Map<string, AgnesRuntimeConfig>();
    const entries = (await this.dbRuntimeConfigs()).sort(
      (a, b) => Number(b.admissionEligible) - Number(a.admissionEligible),
    );
    const seenModelIds = new Set<string>();
    const lookupModels = entries
      .map((entry) => {
        const model = toAgnesModelDefinition({
          config: entry.runtime,
          modelId: entry.modelId,
          source: 'agnes-config',
          ops: entry.ops,
        });
        if (!runtimeByModelId.has(model.id))
          runtimeByModelId.set(model.id, entry.runtime);
        if (!runtimeByModelId.has(model.deployment))
          runtimeByModelId.set(model.deployment, entry.runtime);
        if (!runtimeByModelId.has(entry.runtime.endpointId))
          runtimeByModelId.set(entry.runtime.endpointId, entry.runtime);
        if (!runtimeByModelId.has(`agnes/${entry.runtime.endpointId}`))
          runtimeByModelId.set(
            `agnes/${entry.runtime.endpointId}`,
            entry.runtime,
          );
        if (!runtimeByEndpointId.has(entry.runtime.endpointId))
          runtimeByEndpointId.set(entry.runtime.endpointId, entry.runtime);
        return model;
      })
      .filter((_model, index) => entries[index].admissionEligible);
    const models = lookupModels.filter((model) => {
      if (seenModelIds.has(model.id)) return false;
      seenModelIds.add(model.id);
      return true;
    });

    if (config.enabled && entries.length === 0) {
      this.logger.warn(
        'AGNES_API_KEY is set but no active Agnes AI provider bindings are configured in AI Model Ops.',
      );
    }

    this.cache = {
      expiresAt: Date.now() + config.catalogRefreshMs,
      models,
      lookupModels,
      runtimeByModelId,
      runtimeByEndpointId,
    };
    return this.cache;
  }

  private async dbRuntimeConfigs(): Promise<AgnesRuntimeEntry[]> {
    const config = this.configService.config;
    const rows = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        provider: 'agnes-ai',
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

    return rows.map((row) => {
      const generationModes = stringArray(row.supportedModes);
      const type = row.modality as AiJobType;
      const isVideo = type === 'video';
      const providerCapacity = providerCapacityFromRow(row.providerEndpoint);
      const canonicalGlobalConcurrency =
        numberFromPolicy(row.canonicalModel.queuePolicy, 'globalConcurrency') ??
        (isVideo ? 4 : 12);
      const runtime = createAgnesRuntimeConfig({
        provider: 'agnes-ai',
        endpointId: row.endpointId,
        type,
        name: row.canonicalModel.displayName,
        description:
          row.canonicalModel.description ??
          `${row.displayName ?? row.endpointId} via Agnes AI.`,
        generationModes,
        requiredPlan: requiredPlanFromPolicy(
          row.canonicalModel.entitlementPolicy,
        ),
        enabled: config.enabled,
        disabledReason: config.enabled
          ? (row.disabledReason ?? undefined)
          : 'Agnes AI provider is not enabled for this environment.',
        queueName: isVideo ? AI_QUEUE_VIDEO : AI_QUEUE_IMAGE,
        globalConcurrency: applyProviderConcurrencyLimit(
          canonicalGlobalConcurrency,
          providerCapacity,
        ),
        perUserRunning:
          numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserRunning') ??
          (isVideo ? 1 : 2),
        perUserQueued:
          numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserQueued') ??
          10,
        billingPolicy: billingPolicyFromRow(row),
        parameterPolicy: row.canonicalModel.parameterPolicy as AiJsonValue,
      });
      return {
        admissionEligible: providerBindingAdmissionEligible(row),
        runtime,
        modelId: row.canonicalModel.slug,
        ops: {
          canonicalModelId: row.canonicalModelId,
          canonicalSlug: row.canonicalModel.slug,
          providerAccountId: row.providerAccountId,
          providerBindingId: row.id,
          providerEndpointId: row.providerEndpointId,
          providerRoutePriority: row.priority,
          providerRouteWeight: row.weight,
          providerCapacity,
        },
      };
    });
  }
}

type AgnesRuntimeEntry = {
  admissionEligible: boolean;
  runtime: AgnesRuntimeConfig;
  modelId: string;
  ops: NonNullable<AiModelDefinition['ops']>;
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
}): AiBillingPolicy {
  const policy = recordValue(row.canonicalModel.billingPolicy) ?? {};
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
