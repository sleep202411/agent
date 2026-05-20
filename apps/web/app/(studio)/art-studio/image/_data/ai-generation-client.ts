import { api } from "@/src/lib/api";
import { ApiRequestError } from "@/src/lib/api/api-client";
import { emitUpgrade, payloadFromServerError } from "@/src/lib/quota/upgrade-dialog-store";
import type { AiModel } from "./mock-model";

export interface AiModelsResponse {
  models: AiModel[];
}

export interface AiJobOutput {
  id: string;
  type: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
  createdAt: string;
}

export interface AiJobView {
  id: string;
  type: "image" | "video";
  modelId: string;
  status: string;
  stage: string;
  prompt: string;
  input: Record<string, unknown>;
  outputs: AiJobOutput[];
  error?: { code: string; userMessage: string; retryable: boolean };
  queuePosition?: number | null;
  progress?: number | null;
  estimatedTotalSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AiSubmitResponse {
  request_id: string;
  status: string;
  stage: string;
  progress: number | null;
  queue_position: number | null;
  estimated_wait_seconds: number | null;
  estimated_run_seconds: number | null;
  estimated_total_seconds: number | null;
  eta_confidence: "low" | "medium" | "high";
  logs: Array<{ time: string; stage: string; message: string }>;
  response_url: string;
  status_url: string;
  cancel_url: string;
}

export interface AiJobListResponse {
  jobs: AiJobView[];
  nextCursor?: string | null;
}

export async function listAiModels(): Promise<AiModel[]> {
  const response = await api.get<AiModelsResponse>("/aurora/ai/models", {
    timeout: 15_000,
  });
  return Array.isArray(response.models) ? response.models : [];
}

export async function submitAiJob(input: {
  modelId: string;
  schemaVersion: string;
  values: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<AiSubmitResponse> {
  try {
    return await api.post<AiSubmitResponse>("/aurora/ai/jobs", {
      timeout: 30_000,
      data: {
        modelId: input.modelId,
        schemaVersion: input.schemaVersion,
        input: input.values,
        idempotencyKey: input.idempotencyKey,
      },
    });
  } catch (err) {
    // 429 from the image quota guard → fire the upgrade dialog with
    // the structured payload (dimension/used/limit/nextTier). We catch
    // here, not in the global api-client, so the rest of the app (chat,
    // workflow, profile, ...) doesn't pop the quota dialog on unrelated
    // 429s. The original error still propagates so the caller can
    // surface a toast / inline error state of its own choosing.
    if (err instanceof ApiRequestError && err.status === 429 && err.responseBody) {
      try {
        const parsed = JSON.parse(err.responseBody) as Record<string, unknown>;
        const payload = payloadFromServerError(parsed);
        if (payload) emitUpgrade(payload);
      } catch {
        /* malformed 429 body — ignore, let the error bubble */
      }
    }
    throw err;
  }
}

export async function listAiJobs(params?: {
  type?: "image" | "video";
  limit?: number;
}): Promise<AiJobView[]> {
  const query = new URLSearchParams();
  if (params?.type) query.set("type", params.type);
  if (params?.limit) query.set("limit", String(params.limit));
  const suffix = query.toString();
  const response = await api.get<AiJobListResponse>(
    `/aurora/ai/jobs${suffix ? `?${suffix}` : ""}`,
    { timeout: 15_000 }
  );
  return Array.isArray(response.jobs) ? response.jobs : [];
}

export async function getAiJob(id: string): Promise<AiJobView> {
  return api.get<AiJobView>(`/aurora/ai/jobs/${encodeURIComponent(id)}`, {
    timeout: 15_000,
  });
}

export async function retryAiJob(id: string): Promise<AiSubmitResponse> {
  return api.post<AiSubmitResponse>(`/aurora/ai/jobs/${encodeURIComponent(id)}/retry`, {
    timeout: 30_000,
  });
}
