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
  AiJobType,
  AiJsonValue,
  AiModelDefinition,
} from '../../types';
import { GoogleVertexConfigService } from './google-vertex-config.service';
import {
  createGoogleVertexRuntimeConfig,
  googleVertexExecutionKind,
  toGoogleVertexModelDefinition,
  type GoogleVertexRuntimeConfig,
} from './google-vertex-runtime';

interface GoogleVertexCatalogCache {
  expiresAt: number;
  models: AiModelDefinition[];
  runtimeById: Map<string, GoogleVertexRuntimeConfig>;
}

@Injectable()
export class GoogleVertexCatalogService {
  private readonly logger = new Logger(GoogleVertexCatalogService.name);
  private cache: GoogleVertexCatalogCache | null = null;

  constructor(
    private readonly configService: GoogleVertexConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async listModels(): Promise<AiModelDefinition[]> {
    return (await this.getCache()).models;
  }

  async getModel(modelId: string): Promise<AiModelDefinition | null> {
    const models = (await this.getCache()).models;
    return (
      models.find(
        (model) =>
          model.id === modelId ||
          model.deployment === modelId ||
          `google-vertex/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  async getRuntimeConfig(
    modelId: string,
  ): Promise<GoogleVertexRuntimeConfig | null> {
    return (await this.getCache()).runtimeById.get(modelId) ?? null;
  }

  private async getCache(): Promise<GoogleVertexCatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    const entries = await this.dbRuntimeConfigs();
    const runtimeById = new Map<string, GoogleVertexRuntimeConfig>();
    const models = entries.map((entry) => {
      const model = toGoogleVertexModelDefinition({
        config: entry.runtime,
        source: 'google-vertex-config',
        ops: entry.ops,
      });
      for (const key of [
        model.id,
        model.deployment,
        entry.runtime.endpointId,
        `google-vertex/${entry.runtime.endpointId}`,
      ]) {
        runtimeById.set(key, entry.runtime);
      }
      return model;
    });

    if (this.configService.config.enabled && entries.length === 0) {
      this.logger.warn(
        'GOOGLE_VERTEX_ENABLED=true but no active Google Vertex provider bindings exist in AI Model Ops.',
      );
    }
    this.cache = {
      expiresAt: Date.now() + this.configService.config.catalogRefreshMs,
      models,
      runtimeById,
    };
    return this.cache;
  }

  private async dbRuntimeConfigs(): Promise<GoogleVertexRuntimeEntry[]> {
    const rows = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        provider: 'google-vertex',
        status: 'active',
        archivedAt: null,
        providerAccount: { status: 'active', archivedAt: null },
      },
      include: {
        canonicalModel: true,
        providerAccount: true,
        providerEndpoint: true,
      },
      orderBy: [{ priority: 'asc' }, { weight: 'desc' }, { endpointId: 'asc' }],
    });

    return rows.map((row) => {
      const type = row.modality as AiJobType;
      const isVideo = type === 'video';
      const executionKind = googleVertexExecutionKind(row.endpointId, type);
      const providerCapacity = providerCapacityFromRow(row.providerEndpoint);
      const canonicalConcurrency =
        numberFromPolicy(row.canonicalModel.queuePolicy, 'globalConcurrency') ??
        (isVideo ? 8 : 12);
      const enabled = this.configService.config.enabled;
      const runtime = createGoogleVertexRuntimeConfig({
        modelId: row.canonicalModel.slug,
        endpointId: row.endpointId,
        location:
          executionKind === 'veo'
            ? (this.configService.config.videoLocation ?? '')
            : executionKind === 'omni'
              ? 'global'
              : (this.configService.config.imageLocation ?? ''),
        type,
        name: row.canonicalModel.displayName,
        description:
          row.canonicalModel.description ??
          `${row.displayName ?? row.endpointId} via Google Vertex AI.`,
        generationModes: stringArray(row.supportedModes),
        requiredPlan: requiredPlanFromPolicy(
          row.canonicalModel.entitlementPolicy,
        ),
        enabled,
        disabledReason: enabled
          ? (row.disabledReason ?? undefined)
          : 'Google Vertex AI is not enabled for this environment.',
        queueName: isVideo ? AI_QUEUE_VIDEO : AI_QUEUE_IMAGE,
        globalConcurrency: applyProviderConcurrencyLimit(
          canonicalConcurrency,
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

interface GoogleVertexRuntimeEntry {
  runtime: GoogleVertexRuntimeConfig;
  ops: NonNullable<AiModelDefinition['ops']>;
}

function stringArray(value: unknown): AiGenerationMode[] {
  return Array.isArray(value)
    ? value.filter((item): item is AiGenerationMode => typeof item === 'string')
    : [];
}

function numberFromPolicy(value: unknown, key: string): number | undefined {
  const candidate = record(value)?.[key];
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function billingPolicyFromRow(row: {
  canonicalModel: { billingPolicy: Prisma.JsonValue };
}): AiBillingPolicy {
  const policy = record(row.canonicalModel.billingPolicy) ?? {};
  const productPricing = record(policy.productPricing) as
    | AiBillingPolicy['productPricing']
    | null;
  if (!productPricing) {
    throw new Error('Canonical Google model is missing productPricing.');
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
