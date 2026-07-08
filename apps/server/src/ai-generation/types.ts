import type {
  AiAvailability,
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
import type { EntitlementPlanKey, EntitlementSnapshot } from '../entitlements';
import type {
  AiPromptDocument,
  AiPromptStyleBinding,
  AiSubmitReferenceBinding,
} from './prompt-document.types';

export { AI_MODEL_PROTOCOL_DIALECT } from '@repo/shared';
export type {
  AiAvailability,
  AiBillingPolicy,
  AiCampaignPolicy,
  AiCapabilityMatrix,
  AiConditionExpression,
  AiCostEstimate,
  AiDocumentationLink,
  AiFieldConstraint,
  AiFieldUi,
  AiInputControl,
  AiGenerationMode,
  AiJsonValue,
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
  | 'byteplus-config'
  | 'bailian-config'
  | 'replicate-config'
  | 'agnes-config'
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
 * modules without schema migrations. ProviderRegistry validates the
 * value is registered at request time.
 *
 * Known values today: 'microsoft-foundry', 'fal-ai',
 * 'aliyun-bailian'. Planned: 'replicate', 'stability-self-hosted'.
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
  entitlement: {
    planKey: EntitlementPlanKey;
    requiredPlan: EntitlementPlanKey | null;
    queuePriority: number;
  };
  concurrency: {
    subject: EntitlementSnapshot['subject'];
    queueName: AiQueueName;
    globalConcurrency: number;
    /** Legacy/effective same-type user cap kept for old consumers. */
    perUserRunning: number;
    perUserQueued: number;
    /** Entitlement-subject backlog cap. `null` means unlimited/contractual. */
    perSubjectQueued: number | null;
    /** Entitlement-subject global running cap. `null` means unlimited/contractual. */
    perSubjectRunning: number | null;
    /** Model/type running cap for this subject. `null` means unlimited. */
    perTypeRunning: number | null;
  };
  runtime: {
    maxProviderRuntimeSeconds: number;
    maxQueueWaitSeconds: number | null;
    pollIntervalMs: number;
  };
  providerCapacity?: AiProviderCapacitySnapshot;
}

export interface AiRoutingSnapshot {
  version: '2026-05-27';
  routeId: string;
  presetId: string;
  requestedModelId: string;
  strategy: AiRoutingStrategy;
  selectedProvider: AiProvider;
  selectedModelId: string;
  selectedDeployment: string;
  selectedCanonicalModelId?: string;
  selectedProviderBindingId?: string;
  selectedProviderEndpointId?: string;
  fallbackAllowed: boolean;
  inputMapperVersion: string;
  policy: AiRoutingPolicySnapshot;
  selectedAt: string;
}

export type AiRequiredPlan = EntitlementPlanKey;

/**
 * Per-model entitlement gating. `requiredPlan: null` = anyone.
 * Anything else is checked against the resolved product entitlement
 * snapshot, not the Java auth claim.
 *
 * Deliberately tier-only (no per-day / per-month quota) until a credits
 * system exists. Schema is forward-compatible: add `quotas` here when
 * the time comes without changing call sites.
 */
export interface AiModelEntitlement {
  requiredPlan: AiRequiredPlan | null;
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

export interface AiModelOpsMetadata {
  canonicalModelId: string;
  canonicalSlug: string;
  providerAccountId: string;
  providerBindingId: string;
  providerEndpointId: string;
  providerRoutePriority: number;
  providerRouteWeight: number;
  providerCapacity?: AiProviderCapacitySnapshot;
}

export interface AiProviderCapacitySnapshot {
  maxConcurrentRequests: number | null;
  maxRequestsPerMinute: number | null;
  requestTimeoutSeconds: number | null;
  cooldownSeconds: number | null;
  failureThreshold: number | null;
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
  entitlement: AiModelEntitlement;
  input_schema: FoundryInputSchema;
  output_schema: FoundryOutputSchema;
  provider_output_schema?: FoundryOutputSchema;
  stream_event_schema?: FoundryOutputSchema;
  provider_binding: FoundryProviderBinding;
  ops?: AiModelOpsMetadata;
}

export type FoundryModelDefinition = AiModelDefinition;

export interface AiJobOutput {
  id: string;
  assetId?: string;
  type: AiJobType;
  url: string;
  accessUrl?: string;
  storagePath: string;
  contentHash?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  bytes?: number;
  seed?: bigint;
  safetyFlags?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
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
    | 'BILLING_SETTLEMENT_FAILED'
    | 'WORKER_CRASHED'
    | 'CANCELLED_BY_USER'
    // Character-reference failures at the worker seam (design §3.4):
    // consent revoked / provider mirror gone mid-flight. Terminal — the
    // billing hold is released, the job is never requeued.
    | 'CHARACTER_REVOKED'
    | 'CHARACTER_ASSET_NOT_READY'
    | 'MEDIA_ASSET_NOT_READY'
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
  entitlementSnapshot?: EntitlementSnapshot | null;
  type: AiJobType;
  provider: AiProvider;
  modelId: string;
  deployment: string;
  canonicalModelId: string | null;
  providerBindingId: string | null;
  schemaVersion: string;
  workspaceId?: string | null;
  projectId?: string | null;
  documentId?: string | null;
  documentBlockId?: string | null;
  sourceSurface?: string | null;
  status: AiJobStatus;
  stage: AiJobStage;
  input: Record<string, unknown>;
  normalizedInput: Record<string, unknown>;
  prompt: string;
  promptDocument?: AiPromptDocument | null;
  promptDisplayText?: string | null;
  promptSearchText?: string | null;
  compiledPrompt?: string | null;
  /**
   * ORIGINAL (pre-expansion) reference bindings as submitted — character
   * bindings stay `{refId, role:'character', characterId}` so retryJob
   * re-runs character expansion and re-validates consent/status. Jobs
   * without character bindings keep the compiled bindings (back-compat).
   */
  referenceSnapshot?: AiSubmitReferenceBinding[] | null;
  styleSnapshot?: AiPromptStyleBinding[] | null;
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
  workspaceId?: string;
  projectId?: string;
  documentId?: string;
  documentBlockId?: string;
  sourceSurface?: string;
  context?: {
    workspaceId?: string;
    projectId?: string;
    documentId?: string;
    documentBlockId?: string;
    sourceSurface?: string;
  };
  input?: Record<string, unknown>;
  promptDocument?: AiPromptDocument;
  referenceBindings?: AiSubmitReferenceBinding[];
  styleBindings?: AiPromptStyleBinding[];
  idempotencyKey?: string;
  routing?: {
    presetId?: string;
    campaignId?: string;
  };
}

export interface AiJobListQuery {
  scope?: string;
  workspaceId?: string;
  projectId?: string;
  documentId?: string;
  sourceSurface?: string;
  type?: AiJobType;
  limit?: string;
  cursor?: string;
}

export interface AiStatusResponse {
  request_id: string;
  workspace_id: string | null;
  project_id: string | null;
  document_id: string | null;
  document_block_id: string | null;
  source_surface: string | null;
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
