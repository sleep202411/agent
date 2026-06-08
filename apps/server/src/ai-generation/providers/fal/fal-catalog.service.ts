import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/db/db.module';
import {
  applyProviderConcurrencyLimit,
  providerCapacityFromRow,
} from '../../provider-capacity';
import { AI_QUEUE_IMAGE, AI_QUEUE_VIDEO } from '../../queue';
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
  models: AiModelDefinition[];
  runtimeByModelId: Map<string, FalModelRuntimeConfig>;
  runtimeByEndpointId: Map<string, FalModelRuntimeConfig>;
}

@Injectable()
export class FalCatalogService {
  private readonly logger = new Logger(FalCatalogService.name);
  private cache: FalCatalogCache | null = null;

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
  ): Promise<FalModelRuntimeConfig | null> {
    const cache = await this.getCache();
    return (
      cache.runtimeByModelId.get(modelId) ??
      cache.runtimeByEndpointId.get(modelId) ??
      cache.runtimeByModelId.get(`fal/${modelId}`) ??
      null
    );
  }

  private async getCache(): Promise<FalCatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    const config = this.configService.config;
    const runtimeByModelId = new Map<string, FalModelRuntimeConfig>();
    const runtimeByEndpointId = new Map<string, FalModelRuntimeConfig>();
    const dbRuntimes = await this.dbRuntimeConfigs();
    const runtimeEntries = this.dedupeRuntimeEntries(dbRuntimes);
    const models = runtimeEntries.map((entry) => {
      const model = {
        ...toAiModelDefinition(entry.runtime),
        id: entry.modelId,
        name: entry.name,
        description: entry.description,
        ops: entry.ops,
      };
      runtimeByModelId.set(model.id, entry.runtime);
      runtimeByModelId.set(model.deployment, entry.runtime);
      runtimeByModelId.set(entry.runtime.endpointId, entry.runtime);
      runtimeByModelId.set(`fal/${entry.runtime.endpointId}`, entry.runtime);
      runtimeByEndpointId.set(entry.runtime.endpointId, entry.runtime);
      return model;
    });

    if (config.enabled && runtimeEntries.length === 0) {
      this.logger.warn(
        'FAL_ENABLED=true but no active fal.ai provider bindings are configured in AI Model Ops.',
      );
    }

    this.cache = {
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

    return rows.map((row) => {
      const generationModes = stringArray(row.supportedModes);
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
      return {
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

function requiredPlanFromPolicy(value: unknown): string | null {
  const record = recordValue(value);
  const raw = record?.requiredPlan;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
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
