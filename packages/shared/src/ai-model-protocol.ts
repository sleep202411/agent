import type {
  AiAvailability,
  AiCapabilityMatrix,
  AiConditionExpression,
  AiCostEstimate,
  AiDocumentationLink,
  AiFieldConstraint,
  AiFieldUi,
  AiGenerationMode,
  AiInputControl,
  AiJsonPrimitive,
  AiJsonSchema,
  AiJsonValue,
  AiObjectSchema,
  AiObservabilityContract,
  AiOutputControl,
  AiOutputUi,
  AiPreflightEstimator,
  AiProviderBinding,
  AiSchemaRule,
  AiUiOption,
  AiUiSchema,
} from "./ai-schema.js";
import { AI_MODEL_PROTOCOL_DIALECT, estimateAiPreflightCost } from "./ai-schema.js";
import type { AiProductPricingPolicy } from "./billing.js";

export { AI_MODEL_PROTOCOL_DIALECT, estimateAiPreflightCost };

// Re-export schema contract types (canonical names live in ai-schema).
export type {
  AiJsonPrimitive,
  AiJsonValue,
  AiJsonSchema,
  AiObjectSchema,
  AiInputControl,
  AiOutputControl,
  AiFieldUi,
  AiOutputUi,
  AiUiOption,
  AiUiSchema,
  AiConditionExpression,
  AiFieldConstraint,
  AiSchemaRule,
  AiCapabilityMatrix,
  AiAvailability,
  AiCostEstimate,
  AiPreflightEstimator,
  AiObservabilityContract,
  AiDocumentationLink,
  AiProviderBinding,
  AiGenerationMode,
} from "./ai-schema.js";
export type AiInputSchema = AiObjectSchema;
export type AiOutputSchema = AiObjectSchema;

export type AiModelSchemaDialect = typeof AI_MODEL_PROTOCOL_DIALECT | string;

export type AiModelProviderId =
  | "fal-ai"
  | "byteplus-modelark"
  | "aliyun-bailian"
  | "agnes-ai"
  | "minimax"
  | "dashscope"
  | "self-hosted"
  | string;

export type AiModelFamily = "image" | "video" | "audio" | "text" | "multimodal";

/** Coarse capability used for catalog grouping alongside concrete generation modes. */
export type AiModelCapability =
  | "image_generation"
  | "video_generation"
  | "audio_generation"
  | "text_generation"
  | "multimodal_generation";

export type AiJobOutputType = "image" | "video" | "audio" | "file" | "text";

export type AiModelRouteMode = "managed_preset" | "direct_model" | "campaign_locked";

export type AiPricingUnit =
  | "compute_point"
  | "request"
  | "output"
  | "second"
  | "token"
  | "provider_usage";

/**
 * Active AI Job generation providers. ProviderAccountReconciler upserts a
 * draft account for each key on boot so admin can activate bindings. A key may
 * exist before its server adapter does — that account is a draft placeholder
 * until the adapter ships and the account is activated.
 *
 * Historical DB rows may still store removed vendor strings (e.g. former
 * Foundry/Replicate gen adapters); those are free-form `provider` columns, not
 * onboarded keys. Agent project-cover may still use REPLICATE_API_TOKEN outside
 * this list.
 */
export const AI_PROVIDER_KEYS = [
  "fal-ai",
  "byteplus-modelark",
  "aliyun-bailian",
  "agnes-ai",
  "minimax",
] as const;

export type AiProviderKey = (typeof AI_PROVIDER_KEYS)[number];

/** Human-readable labels for the provider keys (admin UI). */
export const AI_PROVIDER_LABELS: Record<AiProviderKey, string> = {
  "fal-ai": "Fal",
  "byteplus-modelark": "BytePlus ModelArk",
  "aliyun-bailian": "百炼",
  "agnes-ai": "Agnes AI",
  minimax: "MiniMax",
};

export interface AiBillingPolicy {
  mode: "charge" | "free" | "estimate_then_finalize";
  unit: AiPricingUnit;
  displayCurrency: "COMPUTE_POINTS" | "CREDITS" | "USD" | "CNY" | string;
  preflightCost?: number;
  finalCostSource:
    | "product_pricing"
    | "provider_usage"
    | "internal_metering"
    | "campaign"
    | "unknown";
  refundPolicy: "refund_on_final_failure" | "no_refund" | "manual_review";
  /**
   * User-facing product pricing. This is the source of truth for displayed
   * compute-point prices. Provider request cost is recorded later per job
   * only when the provider exposes actual usage/cost.
   */
  productPricing?: AiProductPricingPolicy;
}

export interface AiQueuePolicy {
  queueName: string;
  globalConcurrency: number;
  perUserRunning: number;
  perUserQueued: number;
  priority: number;
  maxProviderRuntimeSeconds?: number;
  maxQueueWaitSeconds?: number;
  retryPolicy?: {
    maxAttempts: number;
    retryableCodes: string[];
    backoffMs: number[];
  };
}

export interface AiEntitlementPolicy {
  requiredPlan: string | null;
  advancedModeRequiredPlan?: string | null;
  optionRequiredPlanField?: string;
}

export interface AiCampaignPolicy {
  campaignId: string;
  label?: string;
  startsAt?: string;
  endsAt?: string;
  eligibleModelIds?: string[];
  perUserLimit?: number;
  totalLimit?: number;
  budgetLimit?: number;
}

export interface AiModelUiPolicy {
  defaultMode: "simple" | "advanced";
  simplePresetIds?: string[];
  advancedVisible?: boolean;
  showProviderName?: boolean;
  showCostEstimate?: boolean;
  showQueueEstimate?: boolean;
  group?: string;
  recommended?: boolean;
  sortOrder?: number;
}

export interface AiModelDefinition {
  id: string;
  provider: AiModelProviderId;
  providerModelId?: string;
  deployment: string;
  modelName: string;
  modelVersion?: string;
  publisher?: string;
  source: string;
  family: AiModelFamily;
  generationModes: AiGenerationMode[];
  capability?: AiModelCapability;
  type: "image" | "video";
  name: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  schemaDialect: AiModelSchemaDialect;
  schemaVersion: string;
  documentation: AiDocumentationLink[];
  capability_matrix: AiCapabilityMatrix;
  availability: AiAvailability;
  cost_estimate: AiCostEstimate;
  preflight_estimator?: AiPreflightEstimator;
  observability: AiObservabilityContract;
  capabilities: {
    textToImage?: boolean;
    imageToImage?: boolean;
    textToVideo?: boolean;
    imageToVideo?: boolean;
    supportsSeed?: boolean;
    supportsCancel?: boolean;
    maxOutputs: number;
  };
  queue: {
    queueName: string;
    globalConcurrency: number;
    perUserRunning: number;
    perUserQueued: number;
  };
  entitlement: {
    requiredPlan: string | null;
  };
  billing_policy?: AiBillingPolicy;
  queue_policy?: AiQueuePolicy;
  entitlement_policy?: AiEntitlementPolicy;
  parameter_policy?: AiJsonValue;
  ui_policy?: AiModelUiPolicy;
  input_schema: AiInputSchema;
  output_schema: AiOutputSchema;
  provider_output_schema?: AiOutputSchema;
  stream_event_schema?: AiOutputSchema;
  provider_binding: AiProviderBinding;
}

export interface AiModelPresetDefinition {
  id: string;
  label: string;
  description?: string;
  family: AiModelFamily;
  generationModes: AiGenerationMode[];
  capability?: AiModelCapability;
  type: "image" | "video";
  routeMode: AiModelRouteMode;
  modelIds: string[];
  enabled: boolean;
  disabledReason?: string;
  requiredPlan?: string | null;
  campaignId?: string;
  fallbackAllowed?: boolean;
  sortOrder?: number;
  billingPolicy: AiBillingPolicy;
  queuePolicy: AiQueuePolicy;
}

export interface AiModelCatalogResponse {
  dialect: typeof AI_MODEL_PROTOCOL_DIALECT;
  version: string;
  region: string;
  presets: AiModelPresetDefinition[];
  models: AiModelDefinition[];
  campaigns?: AiCampaignPolicy[];
}
