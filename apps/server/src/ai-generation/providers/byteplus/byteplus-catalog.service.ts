import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/db/db.module';
import {
  applyProviderConcurrencyLimit,
  capacityTiersFromCatalogSnapshot,
  providerCapacityFromRow,
} from '../../provider-capacity';
import { AI_QUEUE_IMAGE, AI_QUEUE_VIDEO } from '../../queue';
import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiJobType,
  AiJsonValue,
  AiRequiredPlan,
} from '../../types';
import type { AiModelDefinition } from '../../types';
import {
  createBytePlusImageRuntimeConfig,
  createBytePlusVideoRuntimeConfig,
  toBytePlusImageModelDefinition,
  type BytePlusImageRuntimeConfig,
} from './byteplus-runtime';
import { BytePlusConfigService } from './byteplus-config.service';

interface BytePlusCatalogCache {
  expiresAt: number;
  models: AiModelDefinition[];
  runtimeByModelId: Map<string, BytePlusImageRuntimeConfig>;
  runtimeByEndpointId: Map<string, BytePlusImageRuntimeConfig>;
}

@Injectable()
export class BytePlusCatalogService {
  private readonly logger = new Logger(BytePlusCatalogService.name);
  private cache: BytePlusCatalogCache | null = null;

  constructor(
    private readonly configService: BytePlusConfigService,
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
          `byteplus/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  async getRuntimeConfig(
    modelId: string,
  ): Promise<BytePlusImageRuntimeConfig | null> {
    const cache = await this.getCache();
    return (
      cache.runtimeByModelId.get(modelId) ??
      cache.runtimeByEndpointId.get(modelId) ??
      cache.runtimeByModelId.get(`byteplus/${modelId}`) ??
      null
    );
  }

  private async getCache(): Promise<BytePlusCatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    const config = this.configService.config;
    const runtimeByModelId = new Map<string, BytePlusImageRuntimeConfig>();
    const runtimeByEndpointId = new Map<string, BytePlusImageRuntimeConfig>();
    const entries = await this.dbRuntimeConfigs();
    const models = entries.map((entry) => {
      const model = toBytePlusImageModelDefinition({
        config: entry.runtime,
        modelId: entry.modelId,
        source: 'byteplus-config',
        ops: entry.ops,
      });
      runtimeByModelId.set(model.id, entry.runtime);
      runtimeByModelId.set(model.deployment, entry.runtime);
      runtimeByModelId.set(entry.runtime.endpointId, entry.runtime);
      runtimeByModelId.set(
        `byteplus/${entry.runtime.endpointId}`,
        entry.runtime,
      );
      runtimeByEndpointId.set(entry.runtime.endpointId, entry.runtime);
      return model;
    });

    if (config.enabled && entries.length === 0) {
      this.logger.warn(
        'BYTEPLUS_MODELARK_ENABLED=true but no active BytePlus provider bindings are configured in AI Model Ops.',
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

  private async dbRuntimeConfigs(): Promise<BytePlusRuntimeEntry[]> {
    const config = this.configService.config;
    const rows = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        provider: 'byteplus-modelark',
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
        12;
      const createRuntime = isVideo
        ? createBytePlusVideoRuntimeConfig
        : createBytePlusImageRuntimeConfig;
      const runtime = createRuntime({
        provider: 'byteplus-modelark',
        endpointId: row.endpointId,
        name: row.canonicalModel.displayName,
        description:
          row.canonicalModel.description ??
          `${row.displayName ?? row.endpointId} via BytePlus ModelArk.`,
        generationModes,
        requiredPlan: requiredPlanFromPolicy(
          row.canonicalModel.entitlementPolicy,
        ),
        enabled: config.enabled,
        disabledReason: config.enabled
          ? (row.disabledReason ?? undefined)
          : 'BytePlus ModelArk provider is not enabled for this environment.',
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

type BytePlusRuntimeEntry = {
  runtime: BytePlusImageRuntimeConfig;
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
