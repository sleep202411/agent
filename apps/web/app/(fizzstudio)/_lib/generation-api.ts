"use client";

import { api } from "@/src/lib/api";
import { ApiRequestError } from "@/src/lib/api/api-client";
import { emitUpgrade, payloadFromServerError } from "@/src/lib/quota/upgrade-dialog-store";

export type FizzAiJobType = "image" | "video";
export type FizzAiGenerationMode =
  | "first_last_frame_to_video"
  | "image_to_image"
  | "image_to_video"
  | "text_to_image"
  | "text_to_video";

type FizzAiSchemaProperty = {
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, FizzAiSchemaProperty>;
  required?: string[];
  type?: string;
};

export type FizzAiInputSchema = {
  additionalProperties?: boolean;
  properties?: Record<string, FizzAiSchemaProperty>;
  required?: string[];
  type?: "object";
};

export interface FizzAiModel {
  id: string;
  type: FizzAiJobType;
  name: string;
  enabled: boolean;
  disabledReason?: string;
  schemaVersion: string;
  generationModes?: FizzAiGenerationMode[];
  capabilities?: {
    imageToImage?: boolean;
    imageToVideo?: boolean;
    maxOutputs?: number;
    textToImage?: boolean;
    textToVideo?: boolean;
  };
  access?: {
    allowed?: boolean;
    reason?: string;
  };
  input_schema: FizzAiInputSchema;
}

export interface FizzAiCatalog {
  dialect?: string;
  version?: string;
  region?: string;
  models: FizzAiModel[];
}

export interface FizzAiJobOutput {
  id: string;
  type: FizzAiJobType;
  url: string;
  storagePath?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  bytes?: number;
  createdAt: string;
}

export interface FizzAiJobView {
  id: string;
  request_id?: string;
  type: FizzAiJobType;
  workspaceId?: string | null;
  projectId?: string | null;
  documentId?: string | null;
  documentBlockId?: string | null;
  sourceSurface?: string | null;
  provider?: string;
  modelId: string;
  status: string;
  stage: string;
  prompt: string;
  input: Record<string, unknown>;
  outputs: FizzAiJobOutput[];
  error?: {
    code?: string;
    message?: string;
    userMessage?: string;
    retryable?: boolean;
  };
  queuePosition?: number | null;
  progress?: number | null;
  estimatedTotalSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface FizzAiSubmitResponse {
  request_id: string;
  status: string;
  stage: string;
  progress: number | null;
  queue_position: number | null;
  estimated_wait_seconds: number | null;
  estimated_run_seconds: number | null;
  estimated_total_seconds: number | null;
  eta_confidence: "high" | "low" | "medium";
  logs: Array<{ time: string; stage: string; message: string }>;
  response_url: string;
  status_url: string;
  cancel_url: string;
}

export interface FizzAiSubmitJobInput {
  context: {
    workspaceId: string;
    projectId: string;
    documentId: string;
    documentBlockId: string;
    sourceSurface: "fizzstudio-canvas";
  };
  idempotencyKey: string;
  input: Record<string, unknown>;
  modelId: string;
  schemaVersion: string;
}

export function isFizzAiModelUsable(model: FizzAiModel): boolean {
  return model.enabled && model.access?.allowed !== false;
}

export function pickFizzAiModel(
  catalog: FizzAiCatalog,
  type: FizzAiJobType,
  preferredModes: FizzAiGenerationMode[]
): FizzAiModel | null {
  const candidates = catalog.models.filter(
    (model) => model.type === type && isFizzAiModelUsable(model)
  );
  if (candidates.length === 0) return null;

  for (const mode of preferredModes) {
    const byMode = candidates.find((model) => model.generationModes?.includes(mode));
    if (byMode) return byMode;

    const byCapability = candidates.find((model) => {
      if (mode === "text_to_image") return model.capabilities?.textToImage;
      if (mode === "image_to_image") return model.capabilities?.imageToImage;
      if (mode === "text_to_video") return model.capabilities?.textToVideo;
      if (mode === "image_to_video" || mode === "first_last_frame_to_video") {
        return model.capabilities?.imageToVideo;
      }
      return false;
    });
    if (byCapability) return byCapability;
  }

  return candidates[0] ?? null;
}

export function filterFizzAiInput(
  model: FizzAiModel,
  values: Record<string, unknown>
): Record<string, unknown> {
  const properties = model.input_schema?.properties;
  if (!properties || model.input_schema.additionalProperties === true) return values;

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key in properties) next[key] = value;
  }
  return next;
}

export function normalizeFizzAiError(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    if ("responseBody" in error && typeof error.responseBody === "string") {
      try {
        const parsed = JSON.parse(error.responseBody) as Record<string, unknown>;
        const msg = parsed.msg ?? parsed.message;
        if (typeof msg === "string" && msg.trim()) return msg;
      } catch {
        // fall through
      }
    }
    if ("message" in error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

export async function listFizzAiCatalog(): Promise<FizzAiCatalog> {
  const response = await api.get<FizzAiCatalog>("/aurora/ai/models", {
    timeout: 15_000,
  });
  return {
    ...response,
    models: Array.isArray(response.models) ? response.models : [],
  };
}

export async function submitFizzAiJob(input: FizzAiSubmitJobInput): Promise<FizzAiSubmitResponse> {
  try {
    return await api.post<FizzAiSubmitResponse>("/aurora/ai/jobs", {
      timeout: 30_000,
      data: {
        context: input.context,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
        modelId: input.modelId,
        schemaVersion: input.schemaVersion,
      },
    });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 429 && err.responseBody) {
      try {
        const parsed = JSON.parse(err.responseBody) as Record<string, unknown>;
        const payload = payloadFromServerError(parsed);
        if (payload) emitUpgrade(payload);
      } catch {
        // Let the original request error propagate.
      }
    }
    throw err;
  }
}

export async function getFizzAiJob(id: string): Promise<FizzAiJobView> {
  return api.get<FizzAiJobView>(`/aurora/ai/jobs/${encodeURIComponent(id)}`, {
    timeout: 15_000,
  });
}

export async function cancelFizzAiJob(id: string): Promise<FizzAiJobView> {
  return api.post<FizzAiJobView>(`/aurora/ai/jobs/${encodeURIComponent(id)}/cancel`, {
    timeout: 15_000,
  });
}
