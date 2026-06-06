import type {
  FOUNDRY_SCHEMA_DIALECT,
  FoundryAvailability,
  FoundryCapabilityMatrix,
  FoundryConditionExpression,
  FoundryCostEstimate,
  FoundryDocumentationLink,
  FoundryFieldConstraint,
  FoundryFieldUi,
  FoundryInputControl,
  FoundryJsonPrimitive,
  FoundryJsonSchema,
  FoundryJsonValue,
  FoundryObjectSchema,
  FoundryObservabilityContract,
  FoundryOutputControl,
  FoundryOutputUi,
  FoundryPreflightEstimator,
  FoundryProviderBinding,
  FoundrySchemaRule,
  FoundryUiOption,
  FoundryUiSchema,
} from "./foundry-schema.js";

export const AI_MODEL_PROTOCOL_DIALECT = "https://fizzdragon.com/schemas/ai/model/v1";

export type AiJsonPrimitive = FoundryJsonPrimitive;
export type AiJsonValue = FoundryJsonValue;
export type AiJsonSchema = FoundryJsonSchema;
export type AiObjectSchema = FoundryObjectSchema;
export type AiInputSchema = FoundryObjectSchema;
export type AiOutputSchema = FoundryObjectSchema;
export type AiInputControl = FoundryInputControl;
export type AiOutputControl = FoundryOutputControl;
export type AiFieldUi = FoundryFieldUi;
export type AiOutputUi = FoundryOutputUi;
export type AiUiOption = FoundryUiOption;
export type AiUiSchema = FoundryUiSchema;
export type AiConditionExpression = FoundryConditionExpression;
export type AiFieldConstraint = FoundryFieldConstraint;
export type AiSchemaRule = FoundrySchemaRule;
export type AiCapabilityMatrix = FoundryCapabilityMatrix;
export type AiAvailability = FoundryAvailability;
export type AiCostEstimate = FoundryCostEstimate;
export type AiPreflightEstimator = FoundryPreflightEstimator;
export type AiObservabilityContract = FoundryObservabilityContract;
export type AiDocumentationLink = FoundryDocumentationLink;
export type AiProviderBinding = FoundryProviderBinding;

export type AiModelSchemaDialect =
  | typeof AI_MODEL_PROTOCOL_DIALECT
  | typeof FOUNDRY_SCHEMA_DIALECT
  | string;

export type AiModelProviderId =
  | "microsoft-foundry"
  | "fal-ai"
  | "replicate"
  | "dashscope"
  | "self-hosted"
  | string;

export type AiModelFamily = "image" | "video" | "audio" | "text" | "multimodal";

export type AiGenerationMode =
  | "text_to_image"
  | "image_to_image"
  | "inpainting"
  | "outpainting"
  | "reference_image_generation"
  | "text_to_video"
  | "image_to_video"
  | "first_last_frame_to_video"
  | "video_to_video"
  | "text_to_audio"
  | "audio_to_audio"
  | "text_to_text"
  | "multimodal_to_text"
  | "multimodal_to_image"
  | "multimodal_to_video";

/**
 * Legacy coarse capability kept for existing clients. New product logic should
 * use `family` for top-level navigation and `generationModes` for concrete
 * interaction modes.
 */
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
 * Canonical list of providers we onboard. Provider accounts are reconciled from
 * THIS list on boot (one draft account per key). A key may exist before its
 * server adapter does — that account is a draft placeholder: visible/editable in
 * admin, but generation through it fails the ProviderRegistry guard until the
 * adapter ships and the account is activated.
 */
export const AI_PROVIDER_KEYS = [
  "fal-ai",
  "aliyun-bailian",
  "microsoft-foundry",
  "replicate",
  "omnirouters",
] as const;
export type AiProviderKey = (typeof AI_PROVIDER_KEYS)[number];

/** Human-readable labels for the provider keys (admin UI). */
export const AI_PROVIDER_LABELS: Record<AiProviderKey, string> = {
  "fal-ai": "Fal",
  "aliyun-bailian": "百炼",
  "microsoft-foundry": "Azure Foundry",
  replicate: "Replicate",
  omnirouters: "OmniRouters",
};

export interface AiBillingPolicy {
  mode: "charge" | "free" | "estimate_then_finalize";
  unit: AiPricingUnit;
  displayCurrency: "COMPUTE_POINTS" | "CREDITS" | "USD" | "CNY" | string;
  preflightCost?: number;
  finalCostSource: "fixed_table" | "provider_usage" | "internal_metering" | "campaign" | "unknown";
  refundPolicy: "refund_on_final_failure" | "no_refund" | "manual_review";
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
  /** @deprecated Use `family` + `generationModes`. */
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
  /** @deprecated Use `family` + `generationModes`. */
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
