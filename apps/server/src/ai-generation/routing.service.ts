/**
 * AiGenerationRoutingService
 *
 * The submit path asks this service for a routing decision before it
 * writes an AiJob row. The returned snapshot is stored with the job so
 * retries, audits, refunds, and future provider fallbacks all know the
 * exact policy that was applied at submission time.
 *
 * Routing is intentionally provider-agnostic. Provider adapters still
 * own SDK calls and request mapping; this layer only decides which
 * adapter/model/policy should be used for a user intent.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type RequestGeoContext } from '../common/region';
import { EntitlementService, type EntitlementSnapshot } from '../entitlements';
import {
  AiModelPresetRegistryService,
  type AiFreeCampaignConfig,
  type AiModelPresetConfig,
} from './model-preset-registry.service';
import {
  selectProviderModelCandidate,
  type ProviderModelCandidate,
} from './model-catalog-routing';
import { AiCanonicalCatalogService } from './canonical-catalog.service';
import type { ProviderAdapter } from './provider-adapter';
import { ProviderRegistry } from './provider-registry.service';
import type {
  AiCampaignPolicy,
  AiModelDefinition,
  AiModelPresetDefinition,
  AiProvider,
  AiRequiredPlan,
  AiRoutingSnapshot,
  AiSubmitJobBody,
} from './types';

export interface AiRoutingDecision {
  adapter: ProviderAdapter;
  provider: AiProvider;
  model: AiModelDefinition;
  snapshot: AiRoutingSnapshot;
}

@Injectable()
export class AiGenerationRoutingService {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly presets: AiModelPresetRegistryService,
    private readonly entitlements: EntitlementService,
    private readonly catalog: AiCanonicalCatalogService,
  ) {}

  async resolve(args: {
    entitlement: EntitlementSnapshot;
    body: AiSubmitJobBody;
    now: string;
  }): Promise<AiRoutingDecision> {
    const requestedModelId = args.body.modelId?.trim();
    const presetId = this.resolvePresetId(args.body);

    if (!requestedModelId && !presetId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        msg: 'modelId is required.',
      });
    }

    const configuredPreset = presetId
      ? this.presets.findConfiguredPreset(presetId)
      : undefined;
    if (configuredPreset?.enabled === false) {
      throw new BadRequestException({
        code: 'PRESET_NOT_AVAILABLE',
        msg: configuredPreset.disabledReason ?? 'This preset is not available.',
      });
    }

    const configuredRoute = presetId
      ? (configuredPreset ??
        this.presets.findPresetRoute(presetId, await this.listCatalogModels()))
      : undefined;
    const resolved = configuredRoute
      ? await this.resolveConfiguredRoute(configuredRoute, requestedModelId)
      : requestedModelId
        ? await this.findModel(requestedModelId)
        : null;

    if (!resolved) {
      throw new NotFoundException({
        code: 'MODEL_NOT_FOUND',
        msg: 'Model not found.',
      });
    }

    const { adapter, model, provider } = resolved;
    const routePresetId = configuredRoute
      ? this.presets.presetId(configuredRoute)
      : (presetId ?? model.id);
    const strategy =
      configuredRoute?.strategy ??
      (this.requestedCampaignId(args.body)
        ? 'campaign_locked'
        : 'direct_model');
    const freeCampaign = this.resolveFreeCampaign(
      args.body,
      model.id,
      configuredRoute?.campaignId,
    );
    const billingPolicy = this.presets.billingPolicyFor(
      configuredRoute,
      model,
      freeCampaign,
    );
    const queuePolicy = this.presets.queuePolicyFor(configuredRoute, model);
    const queueName = this.presets.queueNameFor(
      queuePolicy.queueName,
      model.type,
    );
    const requiredPlan = this.entitlements.requiredPlan(
      configuredRoute?.requiredPlan ??
        (model.entitlement_policy?.requiredPlan as
          | AiRequiredPlan
          | null
          | undefined) ??
        model.entitlement.requiredPlan,
    );
    const quotaCost =
      billingPolicy.mode === 'free'
        ? 0
        : Number.isFinite(billingPolicy.preflightCost)
          ? Number(billingPolicy.preflightCost)
          : 1;

    return {
      adapter,
      provider,
      model,
      snapshot: {
        version: '2026-05-27',
        routeId: `${freeCampaign ? `campaign:${freeCampaign.id}` : strategy}:${provider}:${model.id}`,
        presetId: routePresetId,
        requestedModelId: requestedModelId ?? routePresetId,
        strategy: freeCampaign ? 'campaign_locked' : strategy,
        selectedProvider: provider,
        selectedModelId: model.id,
        selectedDeployment: model.deployment,
        selectedCanonicalModelId: model.ops?.canonicalModelId,
        selectedProviderBindingId: model.ops?.providerBindingId,
        selectedProviderEndpointId: model.ops?.providerEndpointId,
        fallbackAllowed: configuredRoute?.fallbackAllowed === true,
        inputMapperVersion: model.schemaVersion,
        policy: {
          quota:
            freeCampaign || billingPolicy.mode === 'free'
              ? {
                  mode: 'free',
                  dimension: 'image',
                  cost: 0,
                  reason:
                    freeCampaign?.quotaReason ??
                    `ai_job_campaign_${freeCampaign?.id ?? routePresetId}`,
                  campaignId: freeCampaign?.id ?? configuredRoute?.campaignId,
                  campaign: freeCampaign
                    ? {
                        id: freeCampaign.id,
                        label: freeCampaign.label,
                        startsAt: freeCampaign.startsAt,
                        endsAt: freeCampaign.endsAt,
                        perUserLimit: freeCampaign.perUserLimit,
                        totalLimit: freeCampaign.totalLimit,
                        budgetLimit: freeCampaign.budgetLimit,
                      }
                    : configuredRoute?.campaignId
                      ? { id: configuredRoute.campaignId }
                      : undefined,
                }
              : {
                  mode: 'charge',
                  dimension: 'image',
                  cost: Math.max(0, quotaCost),
                  reason: `ai_job_${routePresetId}`,
                },
          entitlement: {
            planKey: args.entitlement.planKey,
            requiredPlan,
            queuePriority: args.entitlement.limits.queuePriority,
          },
          concurrency: {
            queueName,
            globalConcurrency: queuePolicy.globalConcurrency,
            perUserRunning: queuePolicy.perUserRunning,
            perUserQueued: queuePolicy.perUserQueued,
          },
          runtime: {
            maxProviderRuntimeSeconds:
              queuePolicy?.maxProviderRuntimeSeconds ??
              (model.type === 'video' ? 45 * 60 : 10 * 60),
            maxQueueWaitSeconds: queuePolicy?.maxQueueWaitSeconds ?? null,
            pollIntervalMs: Math.max(
              1_000,
              Number(process.env.AI_ASYNC_PROVIDER_POLL_DELAY_MS ?? 5_000),
            ),
          },
        },
        selectedAt: args.now,
      },
    };
  }

  listPresets(
    models: AiModelDefinition[],
    geo?: RequestGeoContext,
  ): AiModelPresetDefinition[] {
    return this.presets.listCatalogPresets(models, geo);
  }

  listCampaigns(): AiCampaignPolicy[] {
    return this.presets.listCampaignPolicies();
  }

  private resolvePresetId(body: AiSubmitJobBody): string | undefined {
    const raw = body.presetId ?? body.routing?.presetId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  }

  private requestedCampaignId(body: AiSubmitJobBody): string | undefined {
    const raw = body.campaignId ?? body.routing?.campaignId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  }

  private async resolveConfiguredRoute(
    route: AiModelPresetConfig,
    requestedModelId?: string,
  ): Promise<{
    adapter: ProviderAdapter;
    provider: AiProvider;
    model: AiModelDefinition;
  } | null> {
    if (requestedModelId && !route.modelIds.includes(requestedModelId)) {
      throw new BadRequestException({
        code: 'MODEL_NOT_IN_PRESET',
        msg: 'The selected model is not available in this preset.',
      });
    }

    const candidates = requestedModelId
      ? [requestedModelId]
      : route.fallbackAllowed === true
        ? route.modelIds
        : route.modelIds.slice(0, 1);

    for (const modelId of candidates) {
      const resolved = await this.findModel(modelId);
      if (!resolved?.model.enabled) continue;
      return resolved;
    }
    return null;
  }

  private async findModel(modelId: string): Promise<{
    adapter: ProviderAdapter;
    provider: AiProvider;
    model: AiModelDefinition;
  } | null> {
    const candidates: Array<ProviderModelCandidate<ProviderAdapter>> = [];
    for (const adapter of this.providers.list()) {
      const model = await adapter.getModel(modelId);
      if (model) {
        candidates.push({ adapter, provider: adapter.provider, model });
      }
    }
    return selectProviderModelCandidate(candidates);
  }

  private resolveFreeCampaign(
    body: AiSubmitJobBody,
    selectedModelId: string,
    routeCampaignId?: string,
  ): AiFreeCampaignConfig | null {
    const campaignId = this.requestedCampaignId(body) ?? routeCampaignId;
    if (!campaignId) return null;

    const campaign = this.presets
      .listCampaigns()
      .find((item) => item.active !== false && item.id === campaignId);
    if (!campaign) {
      throw new BadRequestException({
        code: 'CAMPAIGN_NOT_AVAILABLE',
        msg: 'This campaign is not available.',
      });
    }

    const now = Date.now();
    if (campaign.startsAt && Date.parse(campaign.startsAt) > now) {
      throw new BadRequestException({
        code: 'CAMPAIGN_NOT_STARTED',
        msg: 'This campaign has not started yet.',
      });
    }
    if (campaign.endsAt && Date.parse(campaign.endsAt) <= now) {
      throw new BadRequestException({
        code: 'CAMPAIGN_ENDED',
        msg: 'This campaign has ended.',
      });
    }
    if (
      Array.isArray(campaign.modelIds) &&
      campaign.modelIds.length > 0 &&
      !campaign.modelIds.includes(selectedModelId)
    ) {
      throw new BadRequestException({
        code: 'CAMPAIGN_MODEL_NOT_ALLOWED',
        msg: 'This model is not available in the selected campaign.',
      });
    }
    return campaign;
  }

  /**
   * Catalog model set used to resolve preset routes. Same canonical-
   * model-driven source the public catalog uses, so presets resolve
   * against exactly the models the catalog shows. (Submit-time
   * multi-provider failover still happens in `findModel` via
   * `selectProviderModelCandidate`.)
   */
  private listCatalogModels(): Promise<AiModelDefinition[]> {
    return this.catalog.listModels();
  }
}
