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
import { BailianConfigService } from './bailian-config.service';
import type {
  BailianModelRuntimeConfig,
  BailianModelService,
} from './bailian.types';
import {
  createBailianModelConfig,
  toAiModelDefinition,
} from './bailian-schema.mapper';

interface BailianCatalogCache {
  expiresAt: number;
  models: AiModelDefinition[];
  runtimeByModelId: Map<string, BailianModelRuntimeConfig>;
  runtimeByEndpointId: Map<string, BailianModelRuntimeConfig>;
}

@Injectable()
export class BailianCatalogService {
  private readonly logger = new Logger(BailianCatalogService.name);
  private cache: BailianCatalogCache | null = null;

  constructor(
    private readonly configService: BailianConfigService,
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
          `bailian/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  async getRuntimeConfig(
    modelId: string,
  ): Promise<BailianModelRuntimeConfig | null> {
    const cache = await this.getCache();
    return (
      cache.runtimeByModelId.get(modelId) ??
      cache.runtimeByEndpointId.get(modelId) ??
      cache.runtimeByModelId.get(`bailian/${modelId}`) ??
      null
    );
  }

  private async getCache(): Promise<BailianCatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    const config = this.configService.config;
    const runtimeByModelId = new Map<string, BailianModelRuntimeConfig>();
    const runtimeByEndpointId = new Map<string, BailianModelRuntimeConfig>();
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
      runtimeByModelId.set(
        `bailian/${entry.runtime.endpointId}`,
        entry.runtime,
      );
      runtimeByEndpointId.set(entry.runtime.endpointId, entry.runtime);
      return model;
    });

    if (config.enabled && runtimeEntries.length === 0) {
      this.logger.warn(
        'BAILIAN_ENABLED=true but no active Alibaba Model Studio provider bindings are configured in AI Model Ops.',
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

  private async dbRuntimeConfigs(): Promise<BailianRuntimeEntry[]> {
    const config = this.configService.config;
    const rows = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        provider: 'aliyun-bailian',
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
      const catalog = recordValue(row.catalogSnapshot);
      const service = bailianServiceFromCatalog(catalog, type);
      const callMode = bailianCallModeFromCatalog(catalog);
      const providerCapacity = providerCapacityFromRow(row.providerEndpoint);
      const canonicalGlobalConcurrency =
        numberFromPolicy(row.canonicalModel.queuePolicy, 'globalConcurrency') ??
        12;
      const runtime = createBailianModelConfig({
        endpointId: row.endpointId,
        service,
        callMode,
        type,
        name: row.canonicalModel.displayName,
        description:
          row.canonicalModel.description ??
          `${row.displayName ?? row.endpointId} via Alibaba Model Studio.`,
        generationModes,
        requiredPlan: requiredPlanFromPolicy(
          row.canonicalModel.entitlementPolicy,
        ),
        enabled: config.enabled,
        disabledReason: config.enabled
          ? (row.disabledReason ?? undefined)
          : 'Alibaba Model Studio provider is not enabled for this environment.',
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
        catalogSnapshot: row.catalogSnapshot as AiJsonValue,
        providerPricing: providerPricingFromCatalog(catalog, config.region),
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

  private dedupeRuntimeEntries(
    entries: BailianRuntimeEntry[],
  ): BailianRuntimeEntry[] {
    const byModelId = new Map<string, BailianRuntimeEntry>();
    for (const entry of entries) {
      if (!byModelId.has(entry.modelId)) byModelId.set(entry.modelId, entry);
    }
    return Array.from(byModelId.values());
  }
}

type BailianRuntimeEntry = {
  runtime: BailianModelRuntimeConfig;
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

function bailianServiceFromCatalog(
  catalog: Record<string, unknown> | null,
  type: AiJobType,
): BailianModelService {
  const service = catalog?.service;
  if (
    service === 'image-generation' ||
    service === 'text2image' ||
    service === 'multimodal-generation' ||
    service === 'video-synthesis'
  ) {
    return service;
  }
  return type === 'video' ? 'video-synthesis' : 'image-generation';
}

function bailianCallModeFromCatalog(
  catalog: Record<string, unknown> | null,
): 'async' | 'sync' {
  return catalog?.callMode === 'sync' ? 'sync' : 'async';
}

function providerPricingFromCatalog(
  catalog: Record<string, unknown> | null,
  region: string,
): Record<string, unknown> | null {
  const pricing = recordValue(catalog?.pricing);
  if (!pricing) return null;
  const currency =
    typeof pricing.currency === 'string' && pricing.currency.trim()
      ? pricing.currency.trim()
      : 'CNY';
  const unit =
    typeof pricing.unit === 'string' && pricing.unit.trim()
      ? pricing.unit.trim()
      : 'image';
  const market = marketForRegion(region);
  const byMarket = recordValue(pricing.unitPriceByMarket);
  const marketPrice = numberFromRecord(byMarket, market);
  const defaultUnitPrice = numberFromRecord(pricing, 'defaultUnitPrice');
  const directUnitPrice = numberFromRecord(pricing, 'unitPrice');
  const unitPrice = marketPrice ?? directUnitPrice ?? defaultUnitPrice;
  if (unitPrice == null) return pricing;
  return {
    ...pricing,
    unit,
    currency,
    unitPrice,
    market,
    region,
  };
}

function marketForRegion(region: string): 'cn' | 'global' {
  const normalized = region.trim().toLowerCase();
  return normalized.startsWith('cn') || normalized === 'beijing'
    ? 'cn'
    : 'global';
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

function numberFromRecord(
  value: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const raw = value?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}
