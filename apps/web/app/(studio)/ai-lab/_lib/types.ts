import type {
  AiCampaignPolicy,
  AiJsonSchema,
  AiModelCatalogResponse,
  AiModelDefinition,
  AiModelPresetDefinition,
  AiObjectSchema,
  AiUiOption,
} from "@repo/shared";

export type AiLabMode = "image" | "video";

export interface AiLabAccess {
  allowed: boolean;
  reason?: "membership_required" | "membership_expired" | "denied" | string;
  requiredPlan?: string | null;
}

export type AiLabModel = Omit<AiModelDefinition, "type"> & {
  type: AiLabMode;
  access?: AiLabAccess;
};

export type AiLabPreset = Omit<AiModelPresetDefinition, "type"> & {
  type: AiLabMode;
};

export type AiLabCatalog = Omit<AiModelCatalogResponse, "models" | "presets" | "campaigns"> & {
  models: AiLabModel[];
  presets: AiLabPreset[];
  campaigns?: AiCampaignPolicy[];
};

export type AiLabSchema = AiObjectSchema;
export type AiLabField = AiJsonSchema;
export type AiLabOption = AiUiOption;

export type AiJobStatus =
  | "in_queue"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type AiJobStage =
  | "created"
  | "queued"
  | "validating"
  | "calling_provider"
  | "provider_queued"
  | "generating"
  | "fetching_output"
  | "uploading_to_oss"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface AiJobOutput {
  id: string;
  type: AiLabMode;
  url: string;
  storagePath?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  bytes?: number;
  createdAt: string;
}

export interface AiJobError {
  code: string;
  message?: string;
  userMessage: string;
  raw?: unknown;
  retryable: boolean;
  createdAt?: string;
}

export interface AiJobLog {
  time: string;
  stage: AiJobStage;
  message: string;
}

export interface AiJobView {
  id: string;
  request_id?: string;
  type: AiLabMode;
  workspaceId?: string | null;
  projectId?: string | null;
  documentId?: string | null;
  documentBlockId?: string | null;
  siteRegion?: string | null;
  sourceSurface?: string | null;
  provider?: string;
  modelId: string;
  deployment?: string;
  status: AiJobStatus;
  stage: AiJobStage;
  routing?: {
    presetId?: string;
    routeId?: string;
    strategy?: string;
    quota?: {
      mode?: "charge" | "free" | "estimate_then_finalize";
      cost?: number;
      campaignId?: string;
      reason?: string;
      campaign?: {
        id: string;
        label?: string;
      };
    };
  } | null;
  queuePosition?: number | null;
  progress?: number | null;
  estimatedWaitSeconds?: number | null;
  estimatedRunSeconds?: number | null;
  estimatedTotalSeconds?: number | null;
  etaConfidence?: "low" | "medium" | "high";
  prompt: string;
  input: Record<string, unknown>;
  outputs: AiJobOutput[];
  error?: AiJobError;
  logs?: AiJobLog[];
  schemaVersion?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface AiJobListResponse {
  jobs: AiJobView[];
  nextCursor?: string | null;
}

export interface AiSubmitResponse {
  request_id: string;
  workspace_id: string | null;
  project_id: string | null;
  document_id: string | null;
  document_block_id: string | null;
  site_region: string | null;
  source_surface: string | null;
  status: AiJobStatus;
  stage: AiJobStage;
  progress: number | null;
  queue_position: number | null;
  estimated_wait_seconds: number | null;
  estimated_run_seconds: number | null;
  estimated_total_seconds: number | null;
  eta_confidence: "low" | "medium" | "high";
  logs: AiJobLog[];
  response_url: string;
  status_url: string;
  cancel_url: string;
}

export interface AiSubmitInput {
  presetId?: string;
  modelId?: string;
  campaignId?: string;
  schemaVersion: string;
  values: Record<string, unknown>;
  idempotencyKey: string;
}
