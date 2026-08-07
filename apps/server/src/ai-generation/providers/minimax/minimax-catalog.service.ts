import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/db/db.module';
import {
  applyProviderConcurrencyLimit,
  capacityTiersFromCatalogSnapshot,
  providerCapacityFromRow,
} from '../../provider-capacity';
import { AI_QUEUE_VIDEO } from '../../queue';
import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiJsonValue,
  AiModelDefinition,
  AiRequiredPlan,
} from '../../types';
import { MiniMaxConfigService } from './minimax-config.service';
import {
  createMiniMaxRuntimeConfig,
  MINIMAX_H3_ENDPOINT,
  MINIMAX_H3_MODEL_ID,
  MINIMAX_PROVIDER,
  type MiniMaxRuntimeConfig,
  toMiniMaxModelDefinition,
} from './minimax-runtime';

interface MiniMaxCatalogCache {
  expiresAt: number;
  models: AiModelDefinition[];
  runtimeByModelId: Map<string, MiniMaxRuntimeConfig>;
}

/**
 * MiniMax catalog — PG-binding-driven (same shape as BytePlus / Bailian).
 * Canonical slug is the runtime model id; endpoint is MiniMax-H3.
 */
@Injectable()
export class MiniMaxCatalogService {
  private readonly logger = new Logger(MiniMaxCatalogService.name);
  private cache: MiniMaxCatalogCache | null = null;

  constructor(
    private readonly configService: MiniMaxConfigService,
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
          model.providerModelId === modelId ||
          `minimax/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  async getRuntimeConfig(
    modelId: string,
  ): Promise<MiniMaxRuntimeConfig | null> {
    const cache = await this.getCache();
    return (
      cache.runtimeByModelId.get(modelId) ??
      cache.runtimeByModelId.get(`minimax/${modelId}`) ??
      null
    );
  }

  private async getCache(): Promise<MiniMaxCatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;

    const config = this.configService.config;
    const runtimeByModelId = new Map<string, MiniMaxRuntimeConfig>();
    const entries = await this.dbRuntimeConfigs();
    const models = entries.map((entry) => {
      const model = toMiniMaxModelDefinition({
        config: entry.runtime,
        modelId: entry.modelId,
        source: 'minimax-config',
        ops: entry.ops,
      });
      runtimeByModelId.set(model.id, entry.runtime);
      runtimeByModelId.set(model.deployment, entry.runtime);
      runtimeByModelId.set(entry.runtime.endpointId, entry.runtime);
      runtimeByModelId.set(
        `minimax/${entry.runtime.endpointId}`,
        entry.runtime,
      );
      runtimeByModelId.set(MINIMAX_H3_MODEL_ID, entry.runtime);
      runtimeByModelId.set(MINIMAX_H3_ENDPOINT, entry.runtime);
      return model;
    });

    if (config.enabled && entries.length === 0) {
      this.logger.warn(
        'MINIMAX_ENABLED=true but no active MiniMax provider bindings are configured in AI Model Ops / seed.',
      );
    }

    this.cache = {
      expiresAt: Date.now() + 30_000,
      models,
      runtimeByModelId,
    };
    return this.cache;
  }

  private async dbRuntimeConfigs(): Promise<MiniMaxRuntimeEntry[]> {
    const config = this.configService.config;
    const rows = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        provider: MINIMAX_PROVIDER,
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
        4;
      const runtime = createMiniMaxRuntimeConfig({
        endpointId: row.endpointId,
        name: row.canonicalModel.displayName,
        description:
          row.canonicalModel.description ??
          `${row.displayName ?? row.endpointId} via MiniMax.`,
        generationModes,
        requiredPlan: requiredPlanFromPolicy(
          row.canonicalModel.entitlementPolicy,
        ),
        enabled: Boolean(config.enabled && config.apiKey),
        disabledReason: !config.apiKey
          ? 'MINIMAX_API_KEY is unset.'
          : !config.enabled
            ? 'MiniMax provider is not enabled for this environment.'
            : (row.disabledReason ?? undefined),
        queueName: AI_QUEUE_VIDEO,
        globalConcurrency: applyProviderConcurrencyLimit(
          canonicalGlobalConcurrency,
          providerCapacity,
        ),
        perUserRunning:
          numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserRunning') ??
          2,
        perUserQueued:
          numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserQueued') ??
          4,
        billingPolicy: billingPolicyFromRow(row),
        parameterPolicy: row.canonicalModel.parameterPolicy as AiJsonValue,
        outputPolicy: row.canonicalModel.outputPolicy as AiJsonValue,
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
          providerCapacityTiers: capacityTiersFromCatalogSnapshot(
            row.providerEndpoint.catalogSnapshot,
          ),
        },
      };
    });
  }
}

type MiniMaxRuntimeEntry = {
  runtime: MiniMaxRuntimeConfig;
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
  // Plan keys only — dead keys normalize to null in EntitlementService
  // (no gate). Keep in sync with membership plan rows.
  if (
    raw === 'free' ||
    raw === 'basic' ||
    raw === 'standard' ||
    raw === 'pro' ||
    raw === 'enterprise' ||
    raw === 'vip'
  ) {
    return raw;
  }
  return null;
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
