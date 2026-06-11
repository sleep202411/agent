import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/db/db.module';
import {
  applyProviderConcurrencyLimit,
  providerCapacityFromRow,
} from '../../provider-capacity';
import { AI_QUEUE_IMAGE } from '../../queue';
import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiJsonValue,
  AiRequiredPlan,
} from '../../types';
import type { AiModelDefinition } from '../../types';
import {
  createReplicateImageRuntimeConfig,
  toReplicateImageModelDefinition,
  type ReplicateImageRuntimeConfig,
} from './replicate-runtime';
import { ReplicateConfigService } from './replicate-config.service';

interface ReplicateCatalogCache {
  expiresAt: number;
  models: AiModelDefinition[];
  runtimeByModelId: Map<string, ReplicateImageRuntimeConfig>;
  runtimeByEndpointId: Map<string, ReplicateImageRuntimeConfig>;
}

@Injectable()
export class ReplicateCatalogService {
  private readonly logger = new Logger(ReplicateCatalogService.name);
  private cache: ReplicateCatalogCache | null = null;

  constructor(
    private readonly configService: ReplicateConfigService,
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
          `replicate/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  async getRuntimeConfig(
    modelId: string,
  ): Promise<ReplicateImageRuntimeConfig | null> {
    const cache = await this.getCache();
    return (
      cache.runtimeByModelId.get(modelId) ??
      cache.runtimeByEndpointId.get(modelId) ??
      cache.runtimeByModelId.get(`replicate/${modelId}`) ??
      null
    );
  }

  private async getCache(): Promise<ReplicateCatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    const config = this.configService.config;
    const runtimeByModelId = new Map<string, ReplicateImageRuntimeConfig>();
    const runtimeByEndpointId = new Map<string, ReplicateImageRuntimeConfig>();
    const entries = await this.dbRuntimeConfigs();
    const models = entries.map((entry) => {
      const model = toReplicateImageModelDefinition({
        config: entry.runtime,
        modelId: entry.modelId,
        source: 'replicate-config',
        ops: entry.ops,
      });
      runtimeByModelId.set(model.id, entry.runtime);
      runtimeByModelId.set(model.deployment, entry.runtime);
      runtimeByModelId.set(entry.runtime.endpointId, entry.runtime);
      runtimeByModelId.set(
        `replicate/${entry.runtime.endpointId}`,
        entry.runtime,
      );
      runtimeByEndpointId.set(entry.runtime.endpointId, entry.runtime);
      return model;
    });

    if (config.enabled && entries.length === 0) {
      this.logger.warn(
        'REPLICATE_ENABLED=true but no active Replicate provider bindings are configured in AI Model Ops.',
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

  private async dbRuntimeConfigs(): Promise<ReplicateRuntimeEntry[]> {
    const config = this.configService.config;
    const rows = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        provider: 'replicate',
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
      const providerCapacity = providerCapacityFromRow(row.providerEndpoint);
      const canonicalGlobalConcurrency =
        numberFromPolicy(row.canonicalModel.queuePolicy, 'globalConcurrency') ??
        12;
      const runtime = createReplicateImageRuntimeConfig({
        provider: 'replicate',
        endpointId: row.endpointId,
        name: row.canonicalModel.displayName,
        description:
          row.canonicalModel.description ??
          `${row.displayName ?? row.endpointId} via Replicate.`,
        generationModes,
        requiredPlan: requiredPlanFromPolicy(
          row.canonicalModel.entitlementPolicy,
        ),
        enabled: config.enabled,
        disabledReason: config.enabled
          ? (row.disabledReason ?? undefined)
          : 'Replicate provider is not enabled for this environment.',
        queueName: AI_QUEUE_IMAGE,
        globalConcurrency: applyProviderConcurrencyLimit(
          canonicalGlobalConcurrency,
          providerCapacity,
        ),
        perUserRunning:
          numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserRunning') ??
          2,
        perUserQueued:
          numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserQueued') ??
          10,
        billingPolicy: billingPolicyFromRow(row),
        parameterPolicy: row.canonicalModel.parameterPolicy as AiJsonValue,
      });
      return {
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

type ReplicateRuntimeEntry = {
  runtime: ReplicateImageRuntimeConfig;
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

function requiredPlanFromPolicy(value: unknown): AiRequiredPlan | null {
  const record = recordValue(value);
  const raw = record?.requiredPlan;
  return isRequiredPlan(raw) ? raw : null;
}

function isRequiredPlan(value: unknown): value is AiRequiredPlan {
  return (
    value === 'free' ||
    value === 'creator' ||
    value === 'pro' ||
    value === 'studio' ||
    value === 'enterprise'
  );
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
