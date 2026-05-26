import type {
  AiAvailability,
  AiCatalogContext,
  AiCapabilityMatrix,
  AiConditionExpression,
  AiCostEstimate,
  AiDocumentationLink,
  AiFieldConstraint,
  AiFieldUi,
  AiInputControl,
  AiJsonSchema,
  AiGenerationMode,
  AiModelFamily,
  AiModelDefinition as SharedAiModelDefinition,
  AiObservabilityContract,
  AiObjectSchema,
  AiOutputUi,
  AiPreflightEstimator,
  AiProviderBinding,
  AiSchemaRule,
  AiUiSchema,
} from '@repo/shared';
export { AI_MODEL_PROTOCOL_DIALECT } from '@repo/shared';
export type {
  AiAvailability,
  AiBillingPolicy,
  AiCatalogContext,
  AiCampaignPolicy,
  AiCapabilityMatrix,
  AiConditionExpression,
  AiCostEstimate,
  AiDocumentationLink,
  AiFieldConstraint,
  AiFieldUi,
  AiInputControl,
  AiGenerationMode,
  AiJsonSchema,
  AiModelFamily,
  AiModelCatalogResponse,
  AiModelPresetDefinition,
  AiObjectSchema,
  AiObservabilityContract,
  AiOutputUi,
  AiPreflightEstimator,
  AiProviderBinding,
  AiQueuePolicy,
  AiRegionPolicy,
  AiSchemaRule,
  AiUiSchema,
} from '@repo/shared';

export type AiJobType = 'image' | 'video';

export type FoundryModelCapability =
  | 'image_generation'
  | 'video_generation'
  | 'unsupported';

export type FoundryCatalogSource =
  | 'foundry-project'
  | 'openai-models'
  | 'env-override'
  | 'fal-config'
  | 'seed-fallback';

export type AiJobStatus =
  | 'in_queue'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type AiJobStage =
  | 'created'
  | 'queued'
  | 'validating'
  | 'calling_provider'
  | 'provider_queued'
  | 'generating'
  | 'fetching_output'
  | 'uploading_to_oss'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type AiEtaConfidence = 'low' | 'medium' | 'high';

/**
 * Provider id — open string because new providers ship as adapter
 * packages without schema migrations. ProviderRegistry validates the
 * value is registered at request time.
 *
 * Known values today: 'microsoft-foundry'. Planned: 'fal-ai',
 * 'replicate', 'stability-self-hosted', 'dashscope'.
 */
export type AiProvider = string;
export type AiQueueName = 'ai-image-generation' | 'ai-video-generation';
export type AiQuotaDimension = 'image' | 'chat' | 'workflow' | 'upload';

export type AiRoutingStrategy =
  | 'direct_model'
  | 'campaign_locked'
  | 'priority_fallback';

export interface AiQuotaPolicySnapshot {
  mode: 'charge' | 'free';
  dimension: AiQuotaDimension;
  cost: number;
  reason: string;
  campaignId?: string;
  campaign?: {
    id: string;
    label?: string;
    startsAt?: string;
    endsAt?: string;
    perUserLimit?: number;
    totalLimit?: number;
    budgetLimit?: number;
  };
}

export interface AiRoutingPolicySnapshot {
  quota: AiQuotaPolicySnapshot;
  tier: {
    userTier: string;
    minTier: AiUserTier | null;
    queuePriority: number;
  };
  concurrency: {
    queueName: AiQueueName;
    globalConcurrency: number;
    perUserRunning: number;
    perUserQueued: number;
  };
  runtime: {
    maxProviderRuntimeSeconds: number;
    maxQueueWaitSeconds: number | null;
    pollIntervalMs: number;
  };
}

export interface AiRoutingSnapshot {
  version: '2026-05-25';
  routeId: string;
  presetId: string;
  requestedModelId: string;
  strategy: AiRoutingStrategy;
  selectedProvider: AiProvider;
  selectedModelId: string;
  selectedDeployment: string;
  fallbackAllowed: boolean;
  inputMapperVersion: string;
  geo?: AiCatalogContext;
  policy: AiRoutingPolicySnapshot;
  selectedAt: string;
}

/**
 * Membership tier ranks. Higher = more access. New tiers only need a
 * single line added here; everything else (schema `minTier`, authz
 * comparison, frontend lock badge) reads from this table.
 */
export const AI_TIER_RANK = {
  FREE: 0,
  VIP: 1,
  VIP1: 1,
  VIP2: 2,
  VIP3: 3,
} as const;

export type AiUserTier = keyof typeof AI_TIER_RANK;

/**
 * Per-model membership gating. `minTier: null` = anyone (incl. free).
 * Anything else = user.userLevel rank must be >= minTier rank.
 *
 * Deliberately tier-only (no per-day / per-month quota) until a credits
 * system exists. Schema is forward-compatible: add `quotas` here when
 * the time comes without changing call sites.
 */
export interface AiMembership {
  minTier: AiUserTier | null;
}

export type AiInputSchema = AiObjectSchema;
export type AiOutputSchema = AiObjectSchema;
export type AiJsonSchemaProperty = AiJsonSchema;

export type FoundryAvailability = AiAvailability;
export type FoundryCapabilityMatrix = AiCapabilityMatrix;
export type FoundryCostEstimate = AiCostEstimate;
export type FoundryDocumentationLink = AiDocumentationLink;
export type FoundryConditionExpression = AiConditionExpression;
export type FoundryFieldConstraint = AiFieldConstraint;
export type FoundryFieldUi = AiFieldUi;
export type FoundryInputControl = AiInputControl;
export type FoundryInputSchema = AiInputSchema;
export type FoundryOutputSchema = AiOutputSchema;
export type FoundryJsonSchemaProperty = AiJsonSchemaProperty;
export type FoundryObservabilityContract = AiObservabilityContract;
export type FoundryObjectSchema = AiObjectSchema;
export type FoundryOutputUi = AiOutputUi;
export type FoundryPreflightEstimator = AiPreflightEstimator;
export type FoundryProviderBinding = AiProviderBinding;
export type FoundrySchemaRule = AiSchemaRule;
export type FoundryUiSchema = AiUiSchema;

export interface FoundryDeploymentRecord {
  id: string;
  deployment: string;
  modelName: string;
  modelVersion?: string;
  publisher?: string;
  displayName?: string;
  description?: string;
  source: FoundryCatalogSource;
  raw?: unknown;
}

export interface AiModelDefinition extends SharedAiModelDefinition {
  id: string;
  provider: AiProvider;
  deployment: string;
  modelName: string;
  modelVersion?: string;
  publisher?: string;
  source: FoundryCatalogSource;
  family: AiModelFamily;
  generationModes: AiGenerationMode[];
  capability: Exclude<FoundryModelCapability, 'unsupported'>;
  type: AiJobType;
  name: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  schemaDialect: string;
  schemaVersion: string;
  documentation: FoundryDocumentationLink[];
  capability_matrix: FoundryCapabilityMatrix;
  availability: FoundryAvailability;
  cost_estimate: FoundryCostEstimate;
  preflight_estimator?: FoundryPreflightEstimator;
  observability: FoundryObservabilityContract;
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
    queueName: AiQueueName;
    globalConcurrency: number;
    perUserRunning: number;
    perUserQueued: number;
  };
  membership: AiMembership;
  input_schema: FoundryInputSchema;
  output_schema: FoundryOutputSchema;
  provider_output_schema?: FoundryOutputSchema;
  stream_event_schema?: FoundryOutputSchema;
  provider_binding: FoundryProviderBinding;
}

export type FoundryModelDefinition = AiModelDefinition;

export interface AiJobOutput {
  id: string;
  type: AiJobType;
  url: string;
  storagePath: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  bytes?: number;
  createdAt: string;
}

export interface AiJobError {
  code:
    | 'VALIDATION_ERROR'
    | 'SCHEMA_VERSION_MISMATCH'
    | 'MEMBERSHIP_REQUIRED'
    | 'MEMBERSHIP_EXPIRED'
    | 'RATE_LIMITED'
    | 'QUEUE_LIMIT_EXCEEDED'
    | 'QUEUE_UNAVAILABLE'
    | 'PROVIDER_NOT_CONFIGURED'
    | 'PROVIDER_429'
    | 'PROVIDER_5XX'
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_CONTENT_FILTER'
    | 'OUTPUT_EXPIRED'
    | 'OSS_UPLOAD_FAILED'
    | 'WORKER_CRASHED'
    | 'CANCELLED_BY_USER'
    | 'UNKNOWN';
  message: string;
  userMessage: string;
  raw?: unknown;
  retryable: boolean;
  createdAt: string;
}

export interface AiJobLog {
  time: string;
  stage: AiJobStage;
  message: string;
}

export interface AiJobMetrics {
  queueWaitMs?: number;
  providerRunMs?: number;
  outputFetchMs?: number;
  ossUploadMs?: number;
  totalMs?: number;
}

export interface AiJob {
  id: string;
  userId: string;
  userLevel?: string | null;
  type: AiJobType;
  provider: AiProvider;
  modelId: string;
  deployment: string;
  schemaVersion: string;
  status: AiJobStatus;
  stage: AiJobStage;
  input: Record<string, unknown>;
  normalizedInput: Record<string, unknown>;
  prompt: string;
  idempotencyKey: string;
  providerJobId?: string;
  providerRequest?: Record<string, unknown>;
  providerResponse?: Record<string, unknown>;
  routingSnapshot?: AiRoutingSnapshot | null;
  outputs: AiJobOutput[];
  error?: AiJobError;
  logs: AiJobLog[];
  queueName: AiQueueName;
  queuePosition?: number | null;
  progress?: number | null;
  estimatedWaitSeconds?: number | null;
  estimatedRunSeconds?: number | null;
  estimatedTotalSeconds?: number | null;
  etaConfidence?: AiEtaConfidence;
  attempt: number;
  retryOfJobId?: string;
  createdAt: string;
  queuedAt?: string;
  startedAt?: string;
  providerSubmittedAt?: string;
  providerStartedAt?: string;
  providerCompletedAt?: string;
  outputFetchedAt?: string;
  ossUploadedAt?: string;
  completedAt?: string;
  updatedAt: string;
  metrics: AiJobMetrics;
}

export interface AiSubmitJobBody {
  modelId?: string;
  presetId?: string;
  campaignId?: string;
  schemaVersion?: string;
  input?: Record<string, unknown>;
  idempotencyKey?: string;
  routing?: {
    presetId?: string;
    campaignId?: string;
  };
}

export interface AiJobListQuery {
  scope?: string;
  type?: AiJobType;
  limit?: string;
  cursor?: string;
}

export interface AiStatusResponse {
  request_id: string;
  status: AiJobStatus;
  stage: AiJobStage;
  progress: number | null;
  queue_position: number | null;
  estimated_wait_seconds: number | null;
  estimated_run_seconds: number | null;
  estimated_total_seconds: number | null;
  eta_confidence: AiEtaConfidence;
  logs: AiJobLog[];
  response_url: string;
}

export interface AiSubmitResponse extends AiStatusResponse {
  status_url: string;
  cancel_url: string;
}
