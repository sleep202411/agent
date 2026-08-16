/** Canonical product schema dialect for AI model contracts. */
export const AI_MODEL_PROTOCOL_DIALECT = "https://fizzdragon.com/schemas/ai/model/v1";

export type AiJsonPrimitive = string | number | boolean | null;
export type AiJsonValue = AiJsonPrimitive | AiJsonValue[] | { [key: string]: AiJsonValue };

export type AiSchemaType = "string" | "integer" | "number" | "boolean" | "array" | "object";

export type AiMediaKind = "text" | "image" | "video" | "audio" | "document" | "file";

export type AiInputControl =
  | "text"
  | "textarea"
  | "select"
  | "segmented"
  | "radio"
  | "checkbox"
  | "switch"
  | "slider"
  | "stepper"
  | "media_upload"
  | "image_upload"
  | "video_upload"
  | "audio_upload"
  | "color"
  | "hidden";

export type AiOutputControl =
  | "image_gallery"
  | "video_player"
  | "audio_player"
  | "file_list"
  | "json"
  | "metadata"
  | "text";

export type AiSchemaImportance = "primary" | "secondary" | "advanced" | "hidden";

export interface AiCondition {
  field: string;
  operator:
    | "equals"
    | "notEquals"
    | "in"
    | "notIn"
    | "exists"
    | "empty"
    | "gt"
    | "gte"
    | "lt"
    | "lte";
  value?: AiJsonValue;
  values?: AiJsonValue[];
}

export interface AiConditionGroup {
  all?: AiConditionExpression[];
  any?: AiConditionExpression[];
  not?: AiConditionExpression;
}

export type AiConditionExpression = AiCondition | AiConditionGroup;

export interface AiUiOption {
  value: string | number | boolean;
  label: string;
  labelKey?: string;
  description?: string;
  descriptionKey?: string;
  icon?: string;
  /**
   * Minimum product plan required to pick this option. Frontend renders
   * a lock badge on options whose plan exceeds the current user's;
   * backend rejects submissions with `MEMBERSHIP_REQUIRED`.
   * `null` / undefined = available to all.
   *
   * Example use: resolution tiers — `hd` open to free users,
   * `fhd` → 'creator', `uhd` → 'pro'.
   */
  requiredPlan?: string | null;
}

export interface AiFieldUi {
  control?: AiInputControl;
  order?: number;
  group?: string;
  importance?: AiSchemaImportance;
  label?: string;
  placeholder?: string;
  hint?: string;
  rows?: number;
  unit?: string;
  accept?: string;
  options?: AiUiOption[];
  /**
   * Structural visibility. When false, renderers should not mount the field at
   * all; this is allowed to change layout and should also hide validation UI.
   */
  visibleWhen?: AiConditionExpression;
  /**
   * Presentation visibility. When false, renderers may keep the field mounted
   * and keep its value, but visually collapse or hide the control.
   */
  showWhen?: AiConditionExpression;
  /**
   * Interaction availability. When false, renderers should keep the field
   * visible but disabled/read-only, usually with disabledReason as helper text.
   */
  enabledWhen?: AiConditionExpression;
  disabledReason?: string;
  labelKey?: string;
  placeholderKey?: string;
  hintKey?: string;
}

export interface AiOutputUi {
  control?: AiOutputControl;
  order?: number;
  group?: string;
  label?: string;
  labelKey?: string;
  emptyState?: string;
  emptyStateKey?: string;
}

export interface AiUiGroup {
  id: string;
  title: string;
  titleKey?: string;
  order: number;
  description?: string;
  descriptionKey?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface AiUiSchema {
  groups: AiUiGroup[];
}

export interface AiProviderFieldBinding {
  parameter?: string;
  path?: string;
  transform?:
    | "identity"
    | "omitAuto"
    | "mediaUrl"
    | "mediaFirstUrl"
    | "mediaArrayToUrls"
    | "mediaArrayToOpenAIImageInput"
    | "uriArrayToFiles"
    | "secondsToDuration"
    | "secondsToInteger";
  omitWhen?: AiConditionExpression;
  omitIfDefault?: boolean;
  omitIfEmpty?: boolean;
}

export interface AiDimensionConstraint {
  kind: "dimension2d";
  allowAuto?: boolean;
  multipleOf?: number;
  minPixels?: number;
  maxPixels?: number;
  maxEdge?: number;
  maxAspectRatio?: number;
}

export interface AiMediaConstraint {
  kind: "media";
  mediaKind: AiMediaKind;
  accept?: string[];
  maxBytes?: number;
}

export type AiFieldConstraint = AiDimensionConstraint | AiMediaConstraint;

export interface AiSchemaRule {
  id: string;
  when: AiConditionExpression;
  effect: "require" | "forbid" | "clear" | "setDefault";
  fields: string[];
  value?: AiJsonValue;
  message: string;
}

export interface AiSchemaBase {
  title?: string;
  titleKey?: string;
  description?: string;
  descriptionKey?: string;
  default?: AiJsonValue;
  examples?: AiJsonValue[];
  enum?: AiJsonPrimitive[];
  const?: AiJsonPrimitive;
  format?: string;
  "x-ui"?: AiFieldUi | AiUiSchema;
  "x-output"?: AiOutputUi;
  "x-provider"?: AiProviderFieldBinding;
  "x-constraints"?: AiFieldConstraint[];
}

export interface AiStringSchema extends AiSchemaBase {
  type: "string";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface AiNumberSchema extends AiSchemaBase {
  type: "number" | "integer";
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export interface AiBooleanSchema extends AiSchemaBase {
  type: "boolean";
}

export interface AiArraySchema extends AiSchemaBase {
  type: "array";
  items: AiJsonSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface AiObjectSchema extends AiSchemaBase {
  type: "object";
  properties: Record<string, AiJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  "x-ui"?: AiFieldUi | AiUiSchema;
  "x-rules"?: AiSchemaRule[];
}

export type AiJsonSchema =
  | AiStringSchema
  | AiNumberSchema
  | AiBooleanSchema
  | AiArraySchema
  | AiObjectSchema;

export interface AiProviderBinding {
  provider: string;
  endpoint: string;
  apiVersion?: string;
  apiVersionParameter?: string;
  apiVersionHeader?: string;
  requestContentType: "application/json" | "multipart/form-data";
  operationSelector?: {
    field: string;
    emptyEndpoint: string;
    presentEndpoint: string;
  };
  passthroughUserId?: boolean;
}

export type AiCapabilitySource = "official" | "provider" | "internal" | "inferred";
export type AiGenerationMode =
  | "text_to_image"
  | "image_to_image"
  | "inpainting"
  | "outpainting"
  | "upscale"
  | "remove_background"
  | "relight"
  | "multi_angle"
  | "reference_image_generation"
  | "text_to_video"
  | "image_to_video"
  | "first_last_frame_to_video"
  | "video_to_video"
  | "text_to_audio"
  | "image_to_audio"
  | "audio_to_audio"
  | "text_to_text"
  | "multimodal_to_text"
  | "multimodal_to_image"
  | "multimodal_to_video";

export interface AiCapabilityMatrix {
  source: AiCapabilitySource;
  inputModalities: AiMediaKind[];
  outputModalities: AiMediaKind[];
  generationModes: AiGenerationMode[];
  supportedParameters: string[];
  unsupportedParameters: string[];
  features: Record<string, boolean>;
  limits: Record<string, number | string | boolean>;
}

export type AiRegionCode = "global" | "cn" | string;
export type AiAvailabilityStatus =
  | "available"
  | "unavailable"
  | "requires_configuration"
  | "unknown";

export interface AiRegionAvailability {
  region: AiRegionCode;
  status: AiAvailabilityStatus;
  reason?: string;
  endpointEnvVars?: string[];
}

export interface AiAvailability {
  currentRegion: AiRegionCode;
  regions: AiRegionAvailability[];
}

export type AiCostMeter =
  | "text_input_tokens"
  | "image_input_tokens"
  | "cached_input_tokens"
  | "image_output_tokens"
  | "video_seconds"
  | "request"
  | "credit";

export interface AiCostMeterDefinition {
  meter: AiCostMeter;
  unit: "token" | "second" | "request" | "credit";
  pricePerMillionUsd?: number;
  pricePerUnitUsd?: number;
  usagePath?: string;
}

export interface AiCostEstimate {
  billingMode: "token" | "duration" | "request" | "credit" | "unknown";
  currency: "USD" | "CNY" | "CREDITS" | string;
  meters: AiCostMeterDefinition[];
  pricingUrl?: string;
  calculatorUrl?: string;
  /**
   * True only when the backend/provider can produce an authoritative estimate
   * before execution. Heuristic UI chips are represented by preflight_estimator.
   */
  supportsPreflightEstimate: boolean;
  finalCostSource:
    | "product_pricing"
    | "provider_usage"
    | "internal_metering"
    | "campaign"
    | "unknown";
}

export type AiPreflightEstimateConfidence = "low" | "medium" | "high";
export type AiPreflightEstimateRounding = "ceil" | "round" | "floor";

export interface AiPreflightEstimate {
  currency: string;
  displayAmount: number;
  confidence: AiPreflightEstimateConfidence;
  estimatedCost?: number;
  estimatedTokens?: {
    input: number;
    output: number;
    total: number;
  };
  breakdown: Record<string, number>;
  notes?: string[];
}

export interface AiTokenHeuristicEstimator {
  kind: "token_heuristic";
  label?: string;
  labelKey?: string;
  confidence: AiPreflightEstimateConfidence;
  currency: "USD" | "CNY" | "CREDITS" | string;
  promptField: string;
  sizeField?: string;
  qualityField?: string;
  countField?: string;
  referenceImagesField?: string;
  charsPerTextToken: number;
  minTextTokens: number;
  imageInputTokensPerReference?: number;
  defaultSize: string;
  autoSize?: string;
  defaultQuality?: string;
  defaultCount?: number;
  baseOutputTokens: number;
  outputTokensPerMegapixel: number;
  qualityMultipliers: Record<string, number>;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  minimumAmount?: number;
  rounding?: AiPreflightEstimateRounding;
  notes?: string[];
}

export type AiPreflightEstimator = AiTokenHeuristicEstimator;

function numberFromInput(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function textFromInput(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringFieldFromInput(
  input: Record<string, unknown>,
  field: string | undefined,
  fallback: string
): string {
  const value = field ? input[field] : undefined;
  return typeof value === "string" ? value : fallback;
}

function countArrayInput(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function parseMegapixels(size: string): number {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return 1;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 1;
  return (width * height) / 1_000_000;
}

function roundEstimate(value: number, rounding: AiPreflightEstimateRounding | undefined): number {
  if (rounding === "floor") return Math.floor(value);
  if (rounding === "round") return Math.round(value);
  return Math.ceil(value);
}

export function estimateAiPreflightCost(
  estimator: AiPreflightEstimator | undefined,
  input: Record<string, unknown>
): AiPreflightEstimate | null {
  if (!estimator) return null;

  const prompt = textFromInput(input[estimator.promptField]);
  const textTokens = Math.max(
    estimator.minTextTokens,
    Math.ceil(prompt.length / estimator.charsPerTextToken)
  );
  const referenceImageTokens =
    countArrayInput(
      estimator.referenceImagesField ? input[estimator.referenceImagesField] : undefined
    ) * (estimator.imageInputTokensPerReference ?? 0);
  const inputTokens = textTokens + referenceImageTokens;

  const rawSize = stringFieldFromInput(input, estimator.sizeField, estimator.defaultSize);
  const size = rawSize === "auto" ? (estimator.autoSize ?? estimator.defaultSize) : rawSize;
  const megapixels = parseMegapixels(size);

  const rawQuality = stringFieldFromInput(
    input,
    estimator.qualityField,
    estimator.defaultQuality ?? "default"
  );
  const quality = rawQuality === "auto" ? (estimator.defaultQuality ?? rawQuality) : rawQuality;
  const qualityMultiplier = estimator.qualityMultipliers[quality] ?? 1;
  const count = Math.max(
    1,
    Math.floor(
      numberFromInput(
        estimator.countField ? input[estimator.countField] : undefined,
        estimator.defaultCount ?? 1
      )
    )
  );

  const outputTokens = Math.ceil(
    (estimator.baseOutputTokens + estimator.outputTokensPerMegapixel * megapixels) *
      qualityMultiplier *
      count
  );
  const estimatedCost =
    (inputTokens * (estimator.inputCostPerMillion ?? 0) +
      outputTokens * (estimator.outputCostPerMillion ?? 0)) /
    1_000_000;
  const flooredCost = Math.max(estimator.minimumAmount ?? 0, estimatedCost);
  const displayAmount = roundEstimate(flooredCost, estimator.rounding);

  return {
    currency: estimator.currency,
    displayAmount,
    confidence: estimator.confidence,
    estimatedCost,
    estimatedTokens: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    },
    breakdown: {
      textTokens,
      referenceImageTokens,
      outputTokens,
      megapixels,
      qualityMultiplier,
      count,
    },
    notes: estimator.notes,
  };
}

export interface AiObservabilityContract {
  requestId: {
    jobField: string;
    inboundHeader?: string;
    outboundHeader?: string;
    providerResponseHeader?: string;
  };
  logging: {
    events: string[];
    redactInputFields: string[];
    redactProviderFields: string[];
  };
  metrics: {
    name: string;
    unit: "ms" | "count" | "ratio" | "tokens" | "bytes";
    description?: string;
  }[];
}

export type AiDocumentationSource = "official" | "provider" | "internal";

export type AiDocumentationScope =
  | "model"
  | "input_schema"
  | "output_schema"
  | "api_reference"
  | "guide"
  | "pricing"
  | "safety"
  | "changelog";

export interface AiDocumentationLink {
  title: string;
  url: string;
  source: AiDocumentationSource;
  scope: AiDocumentationScope;
  provider?: string;
  retrievedAt?: string;
}

export interface AiModelSchemaContract {
  schemaDialect: typeof AI_MODEL_PROTOCOL_DIALECT | string;
  schemaVersion: string;
  documentation: AiDocumentationLink[];
  capability_matrix: AiCapabilityMatrix;
  availability: AiAvailability;
  cost_estimate: AiCostEstimate;
  preflight_estimator?: AiPreflightEstimator;
  observability: AiObservabilityContract;
  input_schema: AiObjectSchema;
  output_schema: AiObjectSchema;
  provider_output_schema?: AiObjectSchema;
  stream_event_schema?: AiObjectSchema;
  provider_binding?: AiProviderBinding;
}
