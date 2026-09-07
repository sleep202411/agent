import type { MediaStorageProvider } from '@prisma/client';
import type {
  AiAvailability,
  AiCapabilityMatrix,
  AiCostEstimate,
  AiDocumentationLink,
  AiJsonSchema,
  AiGenerationMode,
  AiModelFamily,
  AiModelDefinition as SharedAiModelDefinition,
  AiObservabilityContract,
  AiObjectSchema,
  AiPreflightEstimator,
  AiProviderBinding,
} from '@repo/shared';
import type { EntitlementPlanKey, EntitlementSnapshot } from '../entitlements';
import type {
  AiPromptDocument,
  AiPromptStyleBinding,
  AiSubmitReferenceBinding,
} from './prompt-document.types';
import type { ProjectSkillResolutionSnapshot } from '@repo/agent-skills';
import type { ProjectSkillSelection } from '../project-skills';

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

export type AiJobType = 'image' | 'video' | 'audio';
export type AiBillingSubjectType = 'user' | 'workspace';

/** Runtime capability bucket used by catalog adapters (incl. unsupported). */
export type AiRuntimeModelCapability =
  | 'image_generation'
  | 'video_generation'
  | 'audio_generation'
  | 'unsupported';

export type AiCatalogSource =
  | 'foundry-project'
  | 'openai-models'
  | 'env-override'
  | 'fal-config'
  | 'byteplus-config'
  | 'byteplus-speech-config'
  | 'google-vertex-config'
  | 'bailian-config'
  | 'replicate-config'
  | 'agnes-config'
  | 'minimax-config'
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
 * Active generation adapters: fal-ai, byteplus-modelark,
 * byteplus-seed-speech, aliyun-bailian, google-vertex, agnes-ai, minimax.
 * Older job rows may still store removed vendor strings
 * as free-form provider column values (read-only history).
 */
export type AiProvider = string;
export type AiQueueName =
  | 'ai-image-generation'
  | 'ai-video-generation'
  | 'ai-audio-generation';
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
 * snapshot, not external profile claims.
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

export interface AiDeploymentRecord {
  id: string;
  deployment: string;
  modelName: string;
  modelVersion?: string;
  publisher?: string;
  displayName?: string;
  description?: string;
  source: AiCatalogSource;
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
  providerCapacityTiers?: AiProviderCapacityTiers;
}

export interface AiProviderCapacitySnapshot {
  maxConcurrentRequests: number | null;
  maxRequestsPerMinute: number | null;
  requestTimeoutSeconds: number | null;
  cooldownSeconds: number | null;
  failureThreshold: number | null;
  /**
   * Set when this snapshot came from a capacity tier (e.g. the Seedance 4k
   * lane, upstream concurrency 1). The capacity runtime appends it to the
   * Redis bucket key so the tier gets its own lease/RPM lane instead of
   * sharing (or monopolizing) the endpoint-wide bucket.
   */
  tierKey?: string | null;
}

/**
 * Per-endpoint capacity overrides selected by job input at routing time.
 * Seeded via `AiProviderEndpoint.catalogSnapshot.capacityTiers`. Tier fields
 * fall back to the endpoint-level capacity where omitted.
 */
export interface AiProviderCapacityTiers {
  /** Keyed by the job input's `resolution` value (e.g. '4k'). */
  resolution?: Record<string, Partial<AiProviderCapacitySnapshot>>;
}

export interface AiModelDefinition extends SharedAiModelDefinition {
  id: string;
  provider: AiProvider;
  deployment: string;
  modelName: string;
  modelVersion?: string;
  publisher?: string;
  source: AiCatalogSource;
  family: AiModelFamily;
  generationModes: AiGenerationMode[];
  capability: Exclude<AiRuntimeModelCapability, 'unsupported'>;
  type: AiJobType;
  name: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  schemaDialect: string;
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
    textToAudio?: boolean;
    imageToAudio?: boolean;
    audioToAudio?: boolean;
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
  input_schema: AiInputSchema;
  output_schema: AiOutputSchema;
  provider_output_schema?: AiOutputSchema;
  stream_event_schema?: AiOutputSchema;
  provider_binding: AiProviderBinding;
  ops?: AiModelOpsMetadata;
}

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
    | 'MEDIA_STORAGE_UNAVAILABLE'
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
  storyProjectId?: string | null;
  /** Immutable payer snapshot; legacy jobs may omit both fields. */
  billingSubjectType?: AiBillingSubjectType | null;
  billingSubjectId?: string | null;
  documentId?: string | null;
  documentBlockId?: string | null;
  sourceSurface?: string | null;
  /**
   * Storage backend the worker MUST write this job's outputs to, frozen at
   * submit time (see `output-storage-target.ts`). `null` = the cell-default
   * `OutputStorageService` binding, which is what every surface but Story
   * Studio footage uses.
   */
  outputStorageProvider?: MediaStorageProvider | null;
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
  /** Immutable, server-resolved project Skill versions used for this job. */
  skillSnapshot?: ProjectSkillResolutionSnapshot | null;
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
  storyProjectId?: string;
  documentId?: string;
  documentBlockId?: string;
  sourceSurface?: string;
  context?: {
    workspaceId?: string;
    projectId?: string;
    storyProjectId?: string;
    documentId?: string;
    documentBlockId?: string;
    sourceSurface?: string;
  };
  input?: Record<string, unknown>;
  promptDocument?: AiPromptDocument;
  referenceBindings?: AiSubmitReferenceBinding[];
  styleBindings?: AiPromptStyleBinding[];
  /**
   * Per-generation override of installed project Skills. IDs are installation
   * IDs and are re-authorized against the trusted project context server-side.
   */
  skillSelection?: ProjectSkillSelection;
  idempotencyKey?: string;
  routing?: {
    presetId?: string;
    campaignId?: string;
  };
}

export interface AiJobListQuery {
  ids?: string;
  idempotencyKey?: string;
  documentBlockId?: string;
  scope?: string;
  workspaceId?: string;
  projectId?: string;
  storyProjectId?: string;
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
  story_project_id: string | null;
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
