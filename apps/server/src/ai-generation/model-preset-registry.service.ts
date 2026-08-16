/**
 * Product preset registry for AI generation.
 *
 * This is the configuration boundary for product-facing model choices:
 * Fast / Standard / Professional, campaign-exclusive free models, and future
 * admin-managed presets. The current implementation reads env JSON so deploys
 * can change policy without code changes; a DB-backed admin source should
 * replace only this service, not routing/worker/quota.
 */
import { Injectable, Logger } from '@nestjs/common';
import { estimateProductModelPoints } from '@repo/shared';
import type {
  AiBillingPolicy,
  AiCampaignPolicy,
  AiGenerationMode,
  AiJobType,
  AiModelDefinition,
  AiModelFamily,
  AiModelPresetDefinition,
  AiQueueName,
  AiQueuePolicy,
  AiRoutingStrategy,
  AiRequiredPlan,
} from './types';

export interface AiModelPresetConfig {
  id?: string;
  presetId?: string;
  label?: string;
  description?: string;
  family?: AiModelFamily;
  generationModes?: AiGenerationMode[];
  type?: AiJobType;
  modelIds: string[];
  strategy?: AiRoutingStrategy;
  fallbackAllowed?: boolean;
  enabled?: boolean;
  disabledReason?: string;
  requiredPlan?: AiRequiredPlan | null;
  campaignId?: string;
  billingPolicy?: AiBillingPolicy;
  queuePolicy?: AiQueuePolicy;
  sortOrder?: number;
}

export interface AiFreeCampaignConfig {
  id: string;
  label?: string;
  modelIds?: string[];
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
  perUserLimit?: number;
  totalLimit?: number;
  budgetLimit?: number;
  quotaReason?: string;
}

@Injectable()
export class AiModelPresetRegistryService {
  private readonly logger = new Logger(AiModelPresetRegistryService.name);

  findConfiguredPreset(presetId: string): AiModelPresetConfig | undefined {
    return this.configuredPresets().find(
      (preset) => this.presetId(preset) === presetId,
    );
  }

  findPresetRoute(
    presetId: string,
    models: AiModelDefinition[],
  ): AiModelPresetConfig | undefined {
    return (
      this.findConfiguredPreset(presetId) ??
      this.defaultPresetsFromModels(models).find(
        (preset) => this.presetId(preset) === presetId,
      )
    );
  }

  listCatalogPresets(models: AiModelDefinition[]): AiModelPresetDefinition[] {
    const byId = new Map(models.map((model) => [model.id, model]));
    const defaults = this.defaultPresetsFromModels(models);
    const configured = this.configuredPresets();
    const routes = [
      ...configured,
      ...defaults.filter(
        (route) =>
          !configured.some(
            (configuredRoute) =>
              this.presetId(configuredRoute) === this.presetId(route),
          ),
      ),
    ];

    return routes
      .map((route) => this.toCatalogPreset(route, byId))
      .filter((preset): preset is AiModelPresetDefinition => Boolean(preset))
      .sort((a, b) => {
        const order = (a.sortOrder ?? 10_000) - (b.sortOrder ?? 10_000);
        if (order !== 0) return order;
        return a.id.localeCompare(b.id);
      });
  }

  listCampaigns(): AiFreeCampaignConfig[] {
    return this.parseJsonEnv<AiFreeCampaignConfig[]>('AI_FREE_CAMPAIGNS', []);
  }

  listCampaignPolicies(): AiCampaignPolicy[] {
    return this.listCampaigns()
      .filter((campaign) => campaign.active !== false)
      .map((campaign) => ({
        campaignId: campaign.id,
        label: campaign.label,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        eligibleModelIds: campaign.modelIds,
        perUserLimit: campaign.perUserLimit,
        totalLimit: campaign.totalLimit,
        budgetLimit: campaign.budgetLimit,
      }));
  }

  billingPolicyFor(
    preset: AiModelPresetConfig | undefined,
    model: AiModelDefinition,
    campaign: AiFreeCampaignConfig | null,
  ): AiBillingPolicy {
    if (campaign) {
      return {
        mode: 'free',
        unit: 'compute_point',
        displayCurrency: 'COMPUTE_POINTS',
        preflightCost: 0,
        finalCostSource: 'campaign',
        refundPolicy: 'no_refund',
      };
    }
    if (preset?.billingPolicy) return preset.billingPolicy;
    if (model.billing_policy) return model.billing_policy;
    throw new Error(`Model "${model.id}" is missing billing_policy.`);
  }

  queuePolicyFor(
    preset: AiModelPresetConfig | undefined,
    model: AiModelDefinition,
  ): AiQueuePolicy {
    return (
      preset?.queuePolicy ??
      model.queue_policy ??
      this.defaultQueuePolicy(model.type, model)
    );
  }

  queueNameFor(queueName: string, type: AiJobType): AiQueueName {
    if (
      queueName === 'ai-image-generation' ||
      queueName === 'ai-video-generation' ||
      queueName === 'ai-audio-generation'
    ) {
      return queueName;
    }
    return type === 'video'
      ? 'ai-video-generation'
      : type === 'audio'
        ? 'ai-audio-generation'
        : 'ai-image-generation';
  }

  presetId(preset: AiModelPresetConfig): string {
    return (preset.presetId ?? preset.id ?? '').trim();
  }

  private configuredPresets(): AiModelPresetConfig[] {
    return this.parseJsonEnv<AiModelPresetConfig[]>('AI_MODEL_PRESETS', []);
  }

  private toCatalogPreset(
    route: AiModelPresetConfig,
    modelsById: Map<string, AiModelDefinition>,
  ): AiModelPresetDefinition | null {
    const id = this.presetId(route);
    if (!id) return null;

    const models = route.modelIds
      .map((modelId) => modelsById.get(modelId))
      .filter((model): model is AiModelDefinition => Boolean(model));
    const primary = models.find((model) => model.enabled) ?? models[0];
    if (!primary) return null;
    const routeType = route.type ?? primary.type;

    const routeFamily = route.family ?? primary?.family ?? routeType;
    const generationModes =
      route.generationModes ??
      this.unique(models.flatMap((model) => model.generationModes));
    const queuePolicy = primary
      ? this.queuePolicyFor(route, primary)
      : this.defaultQueuePolicy(routeType);
    const billingPolicy = this.billingPolicyFor(route, primary, null);
    const anyEnabled = models.some((model) => model.enabled);

    return {
      id,
      label: route.label ?? this.defaultPresetLabel(id),
      description: route.description,
      family: routeFamily,
      generationModes,
      capability: primary?.capability,
      type: routeType,
      routeMode: route.campaignId ? 'campaign_locked' : 'managed_preset',
      modelIds: route.modelIds,
      enabled: route.enabled !== false && anyEnabled,
      disabledReason:
        route.disabledReason ??
        (!models.length
          ? 'No models are configured for this preset.'
          : !anyEnabled
            ? 'All models in this preset are unavailable.'
            : undefined),
      requiredPlan:
        route.requiredPlan ??
        primary?.entitlement_policy?.requiredPlan ??
        primary?.entitlement.requiredPlan ??
        null,
      campaignId: route.campaignId,
      fallbackAllowed: route.fallbackAllowed === true,
      sortOrder: route.sortOrder,
      billingPolicy,
      queuePolicy,
    };
  }

  private defaultPresetsFromModels(
    models: AiModelDefinition[],
  ): AiModelPresetConfig[] {
    return [
      ...this.defaultPresetsForType(models, 'image'),
      ...this.defaultPresetsForType(models, 'video'),
    ];
  }

  private defaultPresetsForType(
    models: AiModelDefinition[],
    type: AiJobType,
  ): AiModelPresetConfig[] {
    const candidates = models.filter(
      (model) => model.type === type && model.enabled,
    );
    if (!candidates.length) return [];

    const fast = this.sortedByQuality(candidates, 'fast');
    const standard = this.sortedByQuality(candidates, 'standard');
    const professional = this.sortedByQuality(candidates, 'professional');

    return [
      {
        presetId: `${type}.fast`,
        label: 'Fast',
        description: 'Lower latency and lower cost for everyday generation.',
        type,
        family: type,
        modelIds: fast.map((model) => model.id),
        strategy: 'priority_fallback',
        fallbackAllowed: true,
        sortOrder: type === 'image' ? 10 : 40,
      },
      {
        presetId: `${type}.standard`,
        label: 'Standard',
        description: 'Balanced quality, latency, and cost.',
        type,
        family: type,
        modelIds: standard.map((model) => model.id),
        strategy: 'priority_fallback',
        fallbackAllowed: true,
        sortOrder: type === 'image' ? 20 : 50,
      },
      {
        presetId: `${type}.professional`,
        label: 'Professional',
        description: 'Prioritizes quality and advanced model capability.',
        type,
        family: type,
        modelIds: professional.map((model) => model.id),
        strategy: 'priority_fallback',
        fallbackAllowed: true,
        sortOrder: type === 'image' ? 30 : 60,
      },
    ];
  }

  private sortedByQuality(
    models: AiModelDefinition[],
    preset: 'fast' | 'standard' | 'professional',
  ): AiModelDefinition[] {
    return [...models].sort((a, b) => {
      const score =
        this.modelPresetScore(b, preset) - this.modelPresetScore(a, preset);
      if (score !== 0) return score;
      return a.id.localeCompare(b.id);
    });
  }

  private modelPresetScore(
    model: AiModelDefinition,
    preset: 'fast' | 'standard' | 'professional',
  ): number {
    const haystack = [
      model.id,
      model.name,
      model.modelName,
      model.deployment,
      model.description,
    ]
      .join(' ')
      .toLowerCase();
    const cost = this.referenceProductCost(model);
    const concurrency = model.queue.globalConcurrency;
    const planBoost = model.entitlement.requiredPlan ? 3 : 0;

    if (preset === 'fast') {
      return (
        (haystack.includes('schnell') ? 10 : 0) +
        (haystack.includes('fast') || haystack.includes('turbo') ? 8 : 0) +
        concurrency -
        cost
      );
    }
    if (preset === 'professional') {
      return (
        (haystack.includes('pro') || haystack.includes('ultra') ? 8 : 0) +
        planBoost +
        cost +
        (model.capabilities.maxOutputs > 1 ? 2 : 0)
      );
    }
    return (
      (haystack.includes('standard') ? 5 : 0) +
      Math.max(0, 10 - Math.abs(cost - 2)) +
      concurrency / 2
    );
  }

  private referenceProductCost(model: AiModelDefinition): number {
    const productPricing = model.billing_policy?.productPricing;
    if (!productPricing) {
      throw new Error(`Model "${model.id}" is missing productPricing.`);
    }
    return estimateProductModelPoints({ policy: productPricing }).sellPoints;
  }

  private defaultQueuePolicy(
    type: AiJobType,
    model?: AiModelDefinition,
  ): AiQueuePolicy {
    const queueName =
      model?.queue.queueName ??
      (type === 'video'
        ? 'ai-video-generation'
        : type === 'audio'
          ? 'ai-audio-generation'
          : 'ai-image-generation');
    return {
      queueName,
      globalConcurrency:
        model?.queue.globalConcurrency ??
        (type === 'video' ? 2 : type === 'audio' ? 8 : 4),
      perUserRunning:
        model?.queue.perUserRunning ??
        (type === 'video' ? 1 : type === 'audio' ? 4 : 2),
      perUserQueued: model?.queue.perUserQueued ?? 10,
      priority: 0,
      maxProviderRuntimeSeconds:
        type === 'video' ? 45 * 60 : type === 'audio' ? 5 * 60 : 10 * 60,
      maxQueueWaitSeconds: undefined,
    };
  }

  private defaultPresetLabel(id: string): string {
    if (id.endsWith('.fast')) return 'Fast';
    if (id.endsWith('.standard')) return 'Standard';
    if (id.endsWith('.professional')) return 'Professional';
    if (id.includes('campaign')) return 'Campaign exclusive';
    return id;
  }

  private unique<T>(values: T[]): T[] {
    return [...new Set(values)];
  }

  private parseJsonEnv<T>(name: string, fallback: T): T {
    const raw = process.env[name];
    if (!raw?.trim()) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(
        `${name} is not valid JSON; ignoring. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }
  }
}
