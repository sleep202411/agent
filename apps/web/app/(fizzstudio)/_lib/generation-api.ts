"use client";

import { estimateGenerationPrice, type AiGenUnitType } from "@repo/shared";
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
  maximum?: number;
  minimum?: number;
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
  billing_policy?: {
    pricing?: {
      /** nanoUSD as a string; BigInt() it at compute time. */
      unitPriceNanoUsd: string;
      unitType: "per_image" | "per_megapixel" | "per_unit";
      marginBps: number;
    };
  };
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

export type FizzAiSourceSurface = "fizzstudio-canvas" | "fizzstudio-image-studio" | (string & {});

export interface FizzAiSubmitJobInput {
  context: {
    workspaceId: string;
    projectId: string;
    documentId: string;
    documentBlockId: string;
    sourceSurface: FizzAiSourceSurface;
  };
  idempotencyKey: string;
  input: Record<string, unknown>;
  modelId: string;
  schemaVersion: string;
}

/**
 * Terminal-aware status buckets shared by every generation surface. Mirrors the
 * canvas-local helper so feature surfaces don't each re-derive the mapping.
 */
export type FizzAiGenerationStatus = "queued" | "generating" | "done" | "failed" | "cancelled";

export function generationStatusFromRaw(status: string | null | undefined): FizzAiGenerationStatus {
  if (status === "completed") return "done";
  if (status === "failed" || status === "expired") return "failed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "in_progress" || status === "running") return "generating";
  if (status === "in_queue" || status === "queued") return "queued";
  return "queued";
}

export function isTerminalGenerationStatus(status: FizzAiGenerationStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

export function errorMessageFromJob(job: FizzAiJobView, fallback: string): string {
  return job.error?.userMessage || job.error?.message || fallback;
}

export function generationIdempotencyKey(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function compactFizzAiInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );
}

function schemaProperty(model: FizzAiModel, key: string): FizzAiSchemaProperty | undefined {
  return model.input_schema?.properties?.[key];
}

/** String-enum options for a schema field (e.g. `imageSize`), or `null` if absent. */
export function enumOptions(model: FizzAiModel, key: string): string[] | null {
  const prop = schemaProperty(model, key);
  if (!prop?.enum || prop.enum.length === 0) return null;
  return prop.enum.filter((value): value is string => typeof value === "string");
}

export function enumDefault(model: FizzAiModel, key: string): string | undefined {
  const prop = schemaProperty(model, key);
  return typeof prop?.default === "string" ? prop.default : undefined;
}

/**
 * Max output count for an image model. Reads the `numOutputs.maximum` schema
 * field, falling back to `capabilities.maxOutputs`, then 4. Some models omit
 * the field entirely (no batch support) → callers should clamp to 1.
 */
export function maxOutputs(model: FizzAiModel): number {
  const prop = schemaProperty(model, "numOutputs");
  const schemaMax = prop?.maximum;
  if (typeof schemaMax === "number" && schemaMax > 0) return schemaMax;
  if (typeof model.capabilities?.maxOutputs === "number" && model.capabilities.maxOutputs > 0) {
    return model.capabilities.maxOutputs;
  }
  return 4;
}

export function supportsOutputCount(model: FizzAiModel): boolean {
  return Boolean(schemaProperty(model, "numOutputs"));
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

/**
 * Live 积分 sell price for a model + output count, via the shared estimator.
 * Returns null when the model carries no parameterized pricing (no fake
 * placeholder). `approx` is true for per_megapixel models, where the exact
 * megapixels can't be derived from an aspect-token and a 1 MP base is used.
 */
export function estimateModelSellPoints(
  model: FizzAiModel | undefined,
  numImages: number,
  megapixels: number
): { sellPoints: number } | null {
  const pricing = model?.billing_policy?.pricing;
  if (!pricing) return null;
  let unitPriceNanoUsd: bigint;
  try {
    unitPriceNanoUsd = BigInt(pricing.unitPriceNanoUsd || "0");
  } catch {
    return null;
  }
  try {
    const { sellPoints } = estimateGenerationPrice({
      unitPriceNanoUsd,
      unitType: pricing.unitType as AiGenUnitType,
      marginBps: pricing.marginBps,
      numImages: Math.max(1, Math.round(numImages || 1)),
      // Exact megapixels for the chosen size → deterministic price (used only
      // by per_megapixel models; ignored for per_image / per_unit).
      megapixels: Math.max(0.01, megapixels || 1),
    });
    return { sellPoints };
  } catch {
    return null;
  }
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
