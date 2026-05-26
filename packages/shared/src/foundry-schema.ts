export const FOUNDRY_SCHEMA_DIALECT = "https://fizzdragon.com/schemas/foundry/model/v1";

export type FoundryJsonPrimitive = string | number | boolean | null;
export type FoundryJsonValue =
  | FoundryJsonPrimitive
  | FoundryJsonValue[]
  | { [key: string]: FoundryJsonValue };

export type FoundrySchemaType = "string" | "integer" | "number" | "boolean" | "array" | "object";

export type FoundryMediaKind = "text" | "image" | "video" | "audio" | "document" | "file";

export type FoundryInputControl =
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

export type FoundryOutputControl =
  | "image_gallery"
  | "video_player"
  | "audio_player"
  | "file_list"
  | "json"
  | "metadata"
  | "text";

export type FoundrySchemaImportance = "primary" | "secondary" | "advanced" | "hidden";

export interface FoundryCondition {
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
  value?: FoundryJsonValue;
  values?: FoundryJsonValue[];
}

export interface FoundryConditionGroup {
  all?: FoundryConditionExpression[];
  any?: FoundryConditionExpression[];
  not?: FoundryConditionExpression;
}

export type FoundryConditionExpression = FoundryCondition | FoundryConditionGroup;

export interface FoundryUiOption {
  value: string | number | boolean;
  label: string;
  labelKey?: string;
  description?: string;
  descriptionKey?: string;
  icon?: string;
  /**
   * Minimum membership tier required to pick this option. Frontend
   * renders a lock / crown badge on options whose tier exceeds the
   * current user's; backend rejects submissions that include them
   * with `MEMBERSHIP_REQUIRED`. `null` / undefined = available to all.
   *
   * Example use: resolution tiers — `hd` open to free users,
   * `fhd` → 'VIP1', `uhd` → 'VIP2'.
   */
  tier?: string | null;
}

export interface FoundryFieldUi {
  control?: FoundryInputControl;
  order?: number;
  group?: string;
  importance?: FoundrySchemaImportance;
  label?: string;
  placeholder?: string;
  hint?: string;
  rows?: number;
  unit?: string;
  accept?: string;
  options?: FoundryUiOption[];
  /**
   * Structural visibility. When false, renderers should not mount the field at
   * all; this is allowed to change layout and should also hide validation UI.
   */
  visibleWhen?: FoundryConditionExpression;
  /**
   * Presentation visibility. When false, renderers may keep the field mounted
   * and keep its value, but visually collapse or hide the control.
   */
  showWhen?: FoundryConditionExpression;
  /**
   * Interaction availability. When false, renderers should keep the field
   * visible but disabled/read-only, usually with disabledReason as helper text.
   */
  enabledWhen?: FoundryConditionExpression;
  disabledReason?: string;
  labelKey?: string;
  placeholderKey?: string;
  hintKey?: string;
}

export interface FoundryOutputUi {
  control?: FoundryOutputControl;
  order?: number;
  group?: string;
  label?: string;
  labelKey?: string;
  emptyState?: string;
  emptyStateKey?: string;
}

export interface FoundryUiGroup {
  id: string;
  title: string;
  titleKey?: string;
  order: number;
  description?: string;
  descriptionKey?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface FoundryUiSchema {
  groups: FoundryUiGroup[];
}

export interface FoundryProviderFieldBinding {
  parameter?: string;
  path?: string;
  transform?:
    | "identity"
    | "omitAuto"
    | "mediaUrl"
    | "mediaArrayToUrls"
    | "mediaArrayToOpenAIImageInput"
    | "uriArrayToFiles"
    | "secondsToDuration"
    | "secondsToInteger";
  omitWhen?: FoundryConditionExpression;
  omitIfDefault?: boolean;
  omitIfEmpty?: boolean;
}

export interface FoundryDimensionConstraint {
  kind: "dimension2d";
  allowAuto?: boolean;
  multipleOf?: number;
  minPixels?: number;
  maxPixels?: number;
  maxEdge?: number;
  maxAspectRatio?: number;
}

export interface FoundryMediaConstraint {
  kind: "media";
  mediaKind: FoundryMediaKind;
  accept?: string[];
  maxBytes?: number;
}

export type FoundryFieldConstraint = FoundryDimensionConstraint | FoundryMediaConstraint;

export interface FoundrySchemaRule {
  id: string;
  when: FoundryConditionExpression;
  effect: "require" | "forbid" | "clear" | "setDefault";
  fields: string[];
  value?: FoundryJsonValue;
  message: string;
}

export interface FoundrySchemaBase {
  title?: string;
  titleKey?: string;
  description?: string;
  descriptionKey?: string;
  default?: FoundryJsonValue;
  examples?: FoundryJsonValue[];
  enum?: FoundryJsonPrimitive[];
  const?: FoundryJsonPrimitive;
  format?: string;
  "x-ui"?: FoundryFieldUi | FoundryUiSchema;
  "x-output"?: FoundryOutputUi;
  "x-provider"?: FoundryProviderFieldBinding;
  "x-constraints"?: FoundryFieldConstraint[];
}

export interface FoundryStringSchema extends FoundrySchemaBase {
  type: "string";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface FoundryNumberSchema extends FoundrySchemaBase {
  type: "number" | "integer";
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export interface FoundryBooleanSchema extends FoundrySchemaBase {
  type: "boolean";
}

export interface FoundryArraySchema extends FoundrySchemaBase {
  type: "array";
  items: FoundryJsonSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface FoundryObjectSchema extends FoundrySchemaBase {
  type: "object";
  properties: Record<string, FoundryJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  "x-ui"?: FoundryFieldUi | FoundryUiSchema;
  "x-rules"?: FoundrySchemaRule[];
}

export type FoundryJsonSchema =
  | FoundryStringSchema
  | FoundryNumberSchema
  | FoundryBooleanSchema
  | FoundryArraySchema
  | FoundryObjectSchema;

export interface FoundryProviderBinding {
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

export type FoundryCapabilitySource = "official" | "provider" | "internal" | "inferred";
export type FoundryGenerationMode =
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

export interface FoundryCapabilityMatrix {
  source: FoundryCapabilitySource;
  inputModalities: FoundryMediaKind[];
  outputModalities: FoundryMediaKind[];
  generationModes: FoundryGenerationMode[];
  supportedParameters: string[];
  unsupportedParameters: string[];
  features: Record<string, boolean>;
  limits: Record<string, number | string | boolean>;
}

export type FoundryRegionCode = "global" | "cn" | string;
export type FoundryAvailabilityStatus =
  | "available"
  | "unavailable"
  | "requires_configuration"
  | "unknown";

export interface FoundryRegionAvailability {
  region: FoundryRegionCode;
  status: FoundryAvailabilityStatus;
  reason?: string;
  endpointEnvVars?: string[];
}

export interface FoundryAvailability {
  currentRegion: FoundryRegionCode;
  regions: FoundryRegionAvailability[];
}

export type FoundryCostMeter =
  | "text_input_tokens"
  | "image_input_tokens"
  | "cached_input_tokens"
  | "image_output_tokens"
  | "video_seconds"
  | "request"
  | "credit";

export interface FoundryCostMeterDefinition {
  meter: FoundryCostMeter;
  unit: "token" | "second" | "request" | "credit";
  pricePerMillionUsd?: number;
  pricePerUnitUsd?: number;
  usagePath?: string;
}

export interface FoundryCostEstimate {
  billingMode: "token" | "duration" | "request" | "credit" | "unknown";
  currency: "USD" | "CNY" | "CREDITS" | string;
  meters: FoundryCostMeterDefinition[];
  pricingUrl?: string;
  calculatorUrl?: string;
  /**
   * True only when the backend/provider can produce an authoritative estimate
   * before execution. Heuristic UI chips are represented by preflight_estimator.
   */
  supportsPreflightEstimate: boolean;
  finalCostSource: "provider_usage" | "internal_metering" | "fixed_table" | "campaign" | "unknown";
}

export type FoundryPreflightEstimateConfidence = "low" | "medium" | "high";
export type FoundryPreflightEstimateRounding = "ceil" | "round" | "floor";

export interface FoundryPreflightEstimate {
  currency: string;
  displayAmount: number;
  confidence: FoundryPreflightEstimateConfidence;
  estimatedCost?: number;
  estimatedTokens?: {
    input: number;
    output: number;
    total: number;
  };
  breakdown: Record<string, number>;
  notes?: string[];
}

export interface FoundryTokenHeuristicEstimator {
  kind: "token_heuristic";
  label?: string;
  labelKey?: string;
  confidence: FoundryPreflightEstimateConfidence;
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
  rounding?: FoundryPreflightEstimateRounding;
  notes?: string[];
}

export type FoundryPreflightEstimator = FoundryTokenHeuristicEstimator;

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

function roundEstimate(
  value: number,
  rounding: FoundryPreflightEstimateRounding | undefined
): number {
  if (rounding === "floor") return Math.floor(value);
  if (rounding === "round") return Math.round(value);
  return Math.ceil(value);
}

export function estimateFoundryPreflightCost(
  estimator: FoundryPreflightEstimator | undefined,
  input: Record<string, unknown>
): FoundryPreflightEstimate | null {
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

export interface FoundryObservabilityContract {
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

export type FoundryDocumentationSource = "official" | "provider" | "internal";

export type FoundryDocumentationScope =
  | "model"
  | "input_schema"
  | "output_schema"
  | "api_reference"
  | "guide"
  | "pricing"
  | "safety"
  | "changelog";

export interface FoundryDocumentationLink {
  title: string;
  url: string;
  source: FoundryDocumentationSource;
  scope: FoundryDocumentationScope;
  provider?: string;
  retrievedAt?: string;
}

export interface FoundryModelSchemaContract {
  schemaDialect: typeof FOUNDRY_SCHEMA_DIALECT;
  schemaVersion: string;
  documentation: FoundryDocumentationLink[];
  capability_matrix: FoundryCapabilityMatrix;
  availability: FoundryAvailability;
  cost_estimate: FoundryCostEstimate;
  preflight_estimator?: FoundryPreflightEstimator;
  observability: FoundryObservabilityContract;
  input_schema: FoundryObjectSchema;
  output_schema: FoundryObjectSchema;
  provider_output_schema?: FoundryObjectSchema;
  stream_event_schema?: FoundryObjectSchema;
  provider_binding?: FoundryProviderBinding;
}
