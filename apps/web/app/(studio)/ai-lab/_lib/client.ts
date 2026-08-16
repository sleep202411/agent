import { api } from "@/src/lib/api";
import { ApiRequestError } from "@/src/lib/api/api-client";
import { emitUpgrade, payloadFromServerError } from "@/src/lib/quota/upgrade-dialog-store";
import { previewCatalog } from "./preview-catalog";
import type {
  AiJobListResponse,
  AiJobView,
  AiLabCatalog,
  AiLabMode,
  AiSubmitInput,
  AiSubmitResponse,
} from "./types";

const ALLOW_DEV_PREVIEW = process.env.NODE_ENV !== "production";

export async function listAiCatalog(): Promise<{
  catalog: AiLabCatalog;
  source: "live" | "preview";
}> {
  try {
    const catalog = await api.get<AiLabCatalog>("/aurora/ai/models", { timeout: 15_000 });
    return {
      catalog: {
        ...catalog,
        models: catalog.models.filter((model) => model.type === "image" || model.type === "video"),
        presets: catalog.presets.filter(
          (preset) => preset.type === "image" || preset.type === "video"
        ),
      },
      source: "live",
    };
  } catch (error) {
    if (!ALLOW_DEV_PREVIEW) throw error;
    if (process.env.NODE_ENV !== "production") {
      console.warn("[ai-lab] Falling back to development preview catalog.", error);
    }
    return { catalog: previewCatalog(), source: "preview" };
  }
}

export async function submitAiJob(input: AiSubmitInput): Promise<AiSubmitResponse> {
  try {
    return await api.post<AiSubmitResponse>("/aurora/ai/jobs", {
      timeout: 30_000,
      data: {
        presetId: input.presetId,
        modelId: input.modelId,
        campaignId: input.campaignId,
        schemaVersion: input.schemaVersion,
        input: input.values,
        idempotencyKey: input.idempotencyKey,
        sourceSurface: "ai-lab",
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 429 && error.responseBody) {
      try {
        const payload = payloadFromServerError(
          JSON.parse(error.responseBody) as Record<string, unknown>
        );
        if (payload) emitUpgrade(payload);
      } catch {
        /* keep the original error path */
      }
    }
    throw error;
  }
}

export async function listAiJobs(params?: {
  type?: AiLabMode;
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

export async function cancelAiJob(id: string): Promise<AiJobView> {
  return api.post<AiJobView>(`/aurora/ai/jobs/${encodeURIComponent(id)}/cancel`, {
    timeout: 15_000,
  });
}

export function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}
