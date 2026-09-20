import {
  CONTENT_REVIEW_CREDITS_PER_MINUTE,
  CONTENT_REVIEW_MAX_DURATION_SECONDS,
  CONTENT_REVIEW_VIDEO_MAX_BYTES,
  contentReviewCreditsForDurationSeconds,
} from "@repo/shared";
import { api, ApiRequestError } from "@/lib/api";

const RESULT_PATH = "/api/user/video/moderation/ai/result";
const EXPORT_PATH = "/api/user/video/moderation/ai/exportExcel";
const CHARGE_PATH = "/aurora/content-review/charges";
const REVIEW_TIMEOUT_MS = 30 * 60_000;

export function isVideoFileAllowed(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type === "video/mp4" ||
    type === "video/quicktime" ||
    name.endsWith(".mp4") ||
    name.endsWith(".mov")
  );
}

export const MAX_REVIEW_VIDEO_BYTES = CONTENT_REVIEW_VIDEO_MAX_BYTES;
export { CONTENT_REVIEW_CREDITS_PER_MINUTE, CONTENT_REVIEW_MAX_DURATION_SECONDS };
export const creditsForDurationSeconds = contentReviewCreditsForDurationSeconds;

export interface ModerationOverview {
  userId?: number | null;
  url?: string | null;
  taskId?: string | null;
  dataId?: string | null;
  riskLevel?: string | null;
  aiSuggestion?: string | null;
  frameRiskLevel?: string | null;
  audioRiskLevel?: string | null;
  frameNum?: number | null;
  requestId?: string | null;
  finishedAt?: string | null;
}

export interface ModerationDetail {
  source?: string | null;
  timeOffset?: string | null;
  label?: string | null;
  description?: string | null;
  confidence?: number | null;
  frameTempUrl?: string | null;
  audioText?: string | null;
}

export interface ModerationResult {
  overview: ModerationOverview;
  details: ModerationDetail[];
  fileName: string;
  creditsCharged?: number | null;
}

function localeFromPath(): string {
  if (typeof window === "undefined") return "en-US";
  const candidate = window.location.pathname.split("/")[1];
  return candidate === "zh-CN" || candidate === "zh-HK" || candidate === "en-US"
    ? candidate
    : "en-US";
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return utf[1].trim().replace(/^"|"$/g, "");
    }
  }
  const plain = /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim().replace(/^"|"$/g, "") || null;
}

function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

async function readApiError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  let code: string | number = `HTTP_${response.status}`;
  const rawBody = await response.text();
  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const nested =
      body.message && typeof body.message === "object"
        ? (body.message as Record<string, unknown>)
        : null;
    message =
      (typeof nested?.message === "string" ? nested.message : undefined) ??
      (typeof nested?.msg === "string" ? nested.msg : undefined) ??
      (typeof body.message === "string" ? body.message : undefined) ??
      (typeof body.msg === "string" ? body.msg : undefined) ??
      message;
    const codeCandidate = nested?.code ?? body.code;
    if (typeof codeCandidate === "string" || typeof codeCandidate === "number") {
      code = codeCandidate;
    }
  } catch {
    if (rawBody.trim()) message = rawBody.trim();
  }
  throw new ApiRequestError(code, message, response.status, rawBody);
}

function isChargeRouteMissing(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  if (error.status === 404) return true;
  return /cannot post/i.test(`${error.message}\n${error.responseBody ?? ""}`);
}

export async function holdReviewCredits(
  durationSeconds: number,
  signal?: AbortSignal,
  chargeId: string = crypto.randomUUID()
): Promise<{ id: string; credits: number }> {
  try {
    const data = await api.post<{ id: string; credits: number }>(CHARGE_PATH, {
      data: { id: chargeId, durationSeconds },
      signal,
      requestScope: "workspace",
    });
    if (!data?.id || typeof data.credits !== "number") {
      throw new ApiRequestError("INVALID_CHARGE", "Could not reserve compute credits", 200);
    }
    return data;
  } catch (error) {
    if (isChargeRouteMissing(error)) {
      throw new ApiRequestError(
        "CHARGE_UNAVAILABLE",
        "Credit charging is temporarily unavailable",
        error instanceof ApiRequestError ? error.status : 404,
        error instanceof ApiRequestError ? error.responseBody : undefined
      );
    }
    throw error;
  }
}

export async function settleReviewCredits(chargeId: string, signal?: AbortSignal): Promise<void> {
  await api.post(`${CHARGE_PATH}/${chargeId}/settle`, {
    data: {},
    signal,
    requestScope: "workspace",
  });
}

export async function releaseReviewCredits(chargeId: string): Promise<void> {
  await api.post(`${CHARGE_PATH}/${chargeId}/release`, {
    data: {},
    requestScope: "workspace",
  });
}

export async function reviewModeration(
  videoUrl: string,
  signal?: AbortSignal
): Promise<ModerationResult> {
  const data = await api.post<ModerationResult>(RESULT_PATH, {
    data: { url: videoUrl },
    timeout: REVIEW_TIMEOUT_MS,
    signal,
    requestScope: "user",
  });
  if (!data?.overview) {
    throw new ApiRequestError("INVALID_RESULT", "Review returned no overview", 200);
  }
  return {
    overview: data.overview,
    details: Array.isArray(data.details) ? data.details : [],
    fileName: data.fileName || "video-moderation.xlsx",
    creditsCharged: data.creditsCharged ?? null,
  };
}

export async function downloadModerationExcel(
  result: ModerationResult,
  signal?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60_000);
  try {
    const response = await fetch(EXPORT_PATH, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "accept-language": localeFromPath(),
      },
      body: JSON.stringify({
        overview: result.overview,
        details: result.details,
        fileName: result.fileName,
      }),
      signal: controller.signal,
    });
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || contentType.includes("application/json")) {
      await readApiError(response, `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const filename =
      filenameFromDisposition(response.headers.get("content-disposition")) ??
      result.fileName ??
      "video-moderation.xlsx";
    saveBlob(blob, filename);
    return filename;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (timedOut) {
      throw new ApiRequestError("NETWORK_ERROR", "Request timed out", 0);
    }
    if (signal?.aborted || controller.signal.aborted) {
      throw signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("Request aborted", "AbortError");
    }
    throw new ApiRequestError("NETWORK_ERROR", "Network connection failed", 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
