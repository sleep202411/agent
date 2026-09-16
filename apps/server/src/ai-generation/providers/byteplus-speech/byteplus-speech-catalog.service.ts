import { providerBindingAdmissionEligible } from '../../provider-catalog-eligibility';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/db/db.module';
import {
  applyProviderConcurrencyLimit,
  capacityTiersFromCatalogSnapshot,
  providerCapacityFromRow,
} from '../../provider-capacity';
import { requiredPlanFromPolicy } from '../../required-plan';
import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiJsonValue,
  AiModelDefinition,
} from '../../types';
import { BytePlusSpeechConfigService } from './byteplus-speech-config.service';
import {
  createBytePlusSpeechRuntimeConfig,
  toBytePlusSpeechModelDefinition,
  type BytePlusSpeechRuntimeConfig,
} from './byteplus-speech-runtime';

interface CatalogCache {
  expiresAt: number;
  models: AiModelDefinition[];
  lookupModels: AiModelDefinition[];
  runtimeById: Map<string, BytePlusSpeechRuntimeConfig>;
}

@Injectable()
export class BytePlusSpeechCatalogService {
  private readonly logger = new Logger(BytePlusSpeechCatalogService.name);
  private cache: CatalogCache | null = null;
  private cacheRead: Promise<CatalogCache> | null = null;

  constructor(
    private readonly configService: BytePlusSpeechConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async listModels(): Promise<AiModelDefinition[]> {
    return (await this.getCache()).models;
  }

  async getModel(modelId: string): Promise<AiModelDefinition | null> {
    return (
      (await this.getCache()).lookupModels.find(
        (model) =>
          model.id === modelId ||
          model.deployment === modelId ||
          `${model.provider}/${model.deployment}` === modelId,
      ) ?? null
    );
  }

  async getRuntimeConfig(
    modelId: string,
    options?: { forSubmission?: boolean },
  ): Promise<BytePlusSpeechRuntimeConfig | null> {
    if (options?.forSubmission && !(await this.getModel(modelId))) return null;
    return (await this.getCache()).runtimeById.get(modelId) ?? null;
  }

  private async getCache(): Promise<CatalogCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    if (this.cacheRead) return this.cacheRead;
    const pending = this.loadCache().finally(() => {
      if (this.cacheRead === pending) this.cacheRead = null;
    });
    this.cacheRead = pending;
    return pending;
  }

  private async loadCache(): Promise<CatalogCache> {
    const entries = (await this.dbRuntimeConfigs()).sort(
      (a, b) => Number(b.admissionEligible) - Number(a.admissionEligible),
    );
    const runtimeById = new Map<string, BytePlusSpeechRuntimeConfig>();
    const seenModelIds = new Set<string>();
    const lookupModels = entries
      .map((entry) => {
        const model = toBytePlusSpeechModelDefinition({
          config: entry.runtime,
          source: 'byteplus-speech-config',
          ops: entry.ops,
        });
        for (const key of [
          model.id,
          model.deployment,
          `${model.provider}/${model.deployment}`,
        ]) {
          if (!runtimeById.has(key)) runtimeById.set(key, entry.runtime);
        }
        return model;
      })
      .filter((_model, index) => entries[index].admissionEligible);
    const models = lookupModels.filter((model) => {
      if (seenModelIds.has(model.id)) return false;
      seenModelIds.add(model.id);
      return true;
    });
    if (this.configService.config.enabled && entries.length === 0) {
      this.logger.warn(
        'BYTEPLUS_SEED_SPEECH_ENABLED=true but no active BytePlus Seed Speech bindings exist in AI Model Ops.',
      );
    }
    this.cache = {
      expiresAt: Date.now() + this.configService.config.catalogRefreshMs,
      models,
      lookupModels,
      runtimeById,
    };
    return this.cache;
  }

  private async dbRuntimeConfigs(): Promise<BytePlusSpeechRuntimeEntry[]> {
    const rows = await this.prisma.aiProviderModelBinding.findMany({
      where: {
        provider: 'byteplus-seed-speech',
        modality: 'audio',
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
      const providerCapacity = providerCapacityFromRow(row.providerEndpoint);
      const canonicalConcurrency =
        numberFromPolicy(row.canonicalModel.queuePolicy, 'globalConcurrency') ??
        8;
      const enabled = this.configService.config.enabled;
      return {
        admissionEligible: providerBindingAdmissionEligible(row),
        runtime: createBytePlusSpeechRuntimeConfig({
          modelId: row.canonicalModel.slug,
          endpointId: row.endpointId,
          name: row.canonicalModel.displayName,
          description:
            row.canonicalModel.description ??
            `${row.displayName ?? row.endpointId} via BytePlus Seed Speech.`,
          generationModes: stringArray(row.supportedModes),
          enabled,
          disabledReason: enabled
            ? (row.disabledReason ?? undefined)
            : 'BytePlus Seed Speech is not enabled for this environment.',
          requiredPlan: requiredPlanFromPolicy(
            row.canonicalModel.entitlementPolicy,
          ),
          globalConcurrency: applyProviderConcurrencyLimit(
            canonicalConcurrency,
            providerCapacity,
          ),
          perUserRunning:
            numberFromPolicy(
              row.canonicalModel.queuePolicy,
              'perUserRunning',
            ) ?? 4,
          perUserQueued:
            numberFromPolicy(row.canonicalModel.queuePolicy, 'perUserQueued') ??
            10,
          billingPolicy: billingPolicyFromRow(row),
          parameterPolicy: row.canonicalModel.parameterPolicy as AiJsonValue,
          outputPolicy: row.canonicalModel.outputPolicy as AiJsonValue,
        }),
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

interface BytePlusSpeechRuntimeEntry {
  admissionEligible: boolean;
  runtime: BytePlusSpeechRuntimeConfig;
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
    throw new Error(
      'Canonical BytePlus audio model is missing productPricing.',
    );
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
    finalCostSource: 'product_pricing',
    refundPolicy: 'refund_on_final_failure',
    productPricing,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
