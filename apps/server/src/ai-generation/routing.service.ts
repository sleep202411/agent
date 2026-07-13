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
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CharacterKind } from '@prisma/client';
import { estimateProductModelPoints } from '@repo/shared';
import { REAL_PERSON_PROVIDER } from '../characters/character-generation.service';
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
import {
  applyProviderRuntimeLimit,
  selectProviderCapacity,
} from './provider-capacity';
import type { ProviderAdapter } from './provider-adapter';
import { ProviderRegistry } from './provider-registry.service';
import type {
  AiCampaignPolicy,
  AiBillingPolicy,
  AiModelDefinition,
  AiModelPresetDefinition,
  AiProvider,
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
    /**
     * SERVER-resolved kinds of the characters referenced by this job
     * (character expansion runs before routing — design §3.2). Presence of
     * `real_person` arms the post-selection provider pin below. Never derived
     * from client input.
     */
    resolvedCharacterKinds?: CharacterKind[];
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
      ? await this.resolveConfiguredRoute(
          configuredRoute,
          requestedModelId,
          args.body.input,
        )
      : requestedModelId
        ? await this.findModel(requestedModelId, args.body.input)
        : null;

    if (!resolved) {
      throw new NotFoundException({
        code: 'MODEL_NOT_FOUND',
        msg: 'Model not found.',
      });
    }

    // Real-person pin (design §3.2 step 4 / §3.3): a POST-selection assertion
    // on server-resolved truth — unreachable by any client input shape. The
    // likeness lives in the provider's private asset store under a consent
    // ledger; routing it anywhere else would bypass that consent boundary,
    // so this fails the submit rather than falling back.
    if (
      args.resolvedCharacterKinds?.includes('real_person') &&
      resolved.provider !== REAL_PERSON_PROVIDER
    ) {
      throw new ConflictException({
        code: 'REAL_PERSON_REQUIRES_BYTEPLUS',
        msg: 'Real-person characters can only generate on the official BytePlus provider.',
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
    const perSubjectQueued = normalizeNullableLimit(
      args.entitlement.limits.queuedJobs,
    );
    const perSubjectRunning = normalizeNullableLimit(
      args.entitlement.limits.concurrentJobs,
    );
    const perTypeRunning = normalizeRequiredLimit(queuePolicy.perUserRunning);
    const legacyPerUserRunning =
      minNullableLimit(perSubjectRunning, perTypeRunning) ?? 1_000_000_000;
    const legacyPerUserQueued =
      perSubjectQueued ?? normalizeRequiredLimit(queuePolicy.perUserQueued);
    const providerCapacity = selectProviderCapacity(
      model.ops?.providerCapacity,
      model.ops?.providerCapacityTiers,
      stringInput(args.body.input?.resolution),
    );
    const maxProviderRuntimeSeconds = applyProviderRuntimeLimit(
      queuePolicy?.maxProviderRuntimeSeconds ??
        (model.type === 'video' ? 45 * 60 : 10 * 60),
      providerCapacity,
    );
    const requiredPlan = this.entitlements.requiredPlan(
      configuredRoute?.requiredPlan ??
        model.entitlement_policy?.requiredPlan ??
        model.entitlement.requiredPlan,
    );
    const quotaCost =
      billingPolicy.mode === 'free'
        ? 0
        : estimateQuotaCost(billingPolicy, args.body.input);

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
        // TODO(mode-routing-attribution): for multi-endpoint models (e.g.
        // seedance 2.0) these snapshot the PRIMARY binding/endpoint chosen at
        // routing time. The fal adapter resolves the real endpoint per mode at
        // submit (runtime.modeEndpoints) and StartResult.providerEndpoint is
        // persisted on the attempt (worker.service.ts), so attempt-level
        // endpoint attribution is truthful. Binding-id attribution would need
        // model.ops to carry a mode->bindingId map (or back-propagation from
        // StartResult into the snapshot) — do that as one deliberate change,
        // not here.
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
            subject: args.entitlement.subject,
            queueName,
            globalConcurrency: queuePolicy.globalConcurrency,
            perUserRunning: legacyPerUserRunning,
            perUserQueued: legacyPerUserQueued,
            perSubjectQueued,
            perSubjectRunning,
            perTypeRunning,
          },
          runtime: {
            maxProviderRuntimeSeconds,
            maxQueueWaitSeconds: queuePolicy?.maxQueueWaitSeconds ?? null,
            pollIntervalMs: Math.max(
              1_000,
              Number(process.env.AI_ASYNC_PROVIDER_POLL_DELAY_MS ?? 5_000),
            ),
          },
          providerCapacity,
        },
        selectedAt: args.now,
      },
    };
  }

  listPresets(models: AiModelDefinition[]): AiModelPresetDefinition[] {
    return this.presets.listCatalogPresets(models);
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
    input?: Record<string, unknown>,
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
      const resolved = await this.findModel(modelId, input);
      if (!resolved?.model.enabled) continue;
      return resolved;
    }
    return null;
  }

  private async findModel(
    modelId: string,
    input?: Record<string, unknown>,
  ): Promise<{
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
    const selected = selectProviderModelCandidate(candidates, input);
    if (!selected && candidates.length > 0 && input) {
      throw new BadRequestException({
        code: 'MODEL_PROVIDER_PARAMS_UNSUPPORTED',
        msg: 'No active provider endpoint supports the selected parameter combination.',
      });
    }
    return selected;
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

function estimateQuotaCost(
  billingPolicy: AiBillingPolicy,
  input: Record<string, unknown> | undefined,
): number {
  const productPricing = billingPolicy.productPricing;

  if (!productPricing) {
    throw new BadRequestException({
      code: 'MODEL_PRICING_NOT_CONFIGURED',
      msg: 'This model is missing product pricing.',
    });
  }

  try {
    return estimateProductModelPoints({
      policy: productPricing,
      numOutputs: numberInput(input?.numOutputs),
      resolution: stringInput(input?.resolution),
      quality: stringInput(input?.quality),
      // Duration drives per-second video pricing (quote == charge). `duration`
      // is the string-enum field (incl. 'auto'); `durationSeconds` is the
      // legacy integer-slider field.
      duration: durationInput(input?.duration),
      durationSeconds: numberInput(input?.durationSeconds),
      referenceImageCount: arrayLength(input?.referenceImages),
      hasMask: hasMediaValue(input?.maskImage),
    }).sellPoints;
  } catch (err) {
    throw new BadRequestException({
      code: 'MODEL_PRICING_INVALID',
      msg:
        err instanceof Error
          ? `Invalid product pricing: ${err.message}`
          : 'Invalid product pricing.',
    });
  }
}

function numberInput(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeRequiredLimit(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return 1;
}

function normalizeNullableLimit(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return null;
}

function minNullableLimit(
  left: number | null,
  right: number | null,
): number | null {
  if (left == null) return right;
  if (right == null) return left;
  return Math.min(left, right);
}

function durationInput(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringInput(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function hasMediaValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object') return false;
  return (
    'url' in value &&
    typeof (value as { url?: unknown }).url === 'string' &&
    Boolean((value as { url?: string }).url?.trim())
  );
}
