import { fetchCrewAssetAccess } from "@/features/crew-assets/api";
import { CONTENT_REVIEW_MAX_DURATION_SECONDS } from "@repo/shared";
import { z } from "zod";
import { api, type ApiBinaryResponse } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchWorkspaceSettings } from "./studio-workspace-settings-api";
const summary = z.object({
  id: z.string().uuid(),
  mediaAssetId: z.string().uuid(),
  fileName: z.string(),
  durationSeconds: z.number().finite().nonnegative(),
  creditsCharged: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
  suggestion: z.string().nullable(),
  riskLevel: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
});
const text = z.string().nullable().optional();
export const contentReviewDetailSchema = summary.extend({
  exportFileName: z.string(),
  overview: z.object({
    userId: z.number().nullable().optional(),
    url: text,
    taskId: text,
    dataId: text,
    requestId: text,
    riskLevel: text,
    aiSuggestion: text,
    frameRiskLevel: text,
    audioRiskLevel: text,
    frameNum: z.number().nullable().optional(),
    finishedAt: text,
  }),
  details: z.array(
    z.object({
      source: text,
      timeOffset: text,
      label: text,
      description: text,
      confidence: z.number().finite().nullable().optional(),
      frameTempUrl: text,
      audioText: text,
    })
  ),
  comments: z.array(
    z.object({
      id: z.string(),
      seconds: z.number().finite().nonnegative(),
      body: z.string(),
      createdByUserId: z.string(),
      createdAt: z.string(),
    })
  ),
});
export type ContentReviewSummary = z.infer<typeof summary>;
export type ContentReviewDetail = z.infer<typeof contentReviewDetailSchema>;
function current(generation: number, signal: AbortSignal) {
  if (generation !== getAuthGeneration() || signal.aborted)
    throw new Error("Content review session expired");
}
async function authorize(workspaceId: string, generation: number, signal: AbortSignal) {
  current(generation, signal);
  const workspace = await fetchWorkspaceSettings(workspaceId, generation, signal);
  current(generation, signal);
  if (workspace.status !== "active" || workspace.accessScope !== "workspace")
    throw new Error("Workspace membership is required");
  return {
    service: "aurora" as const,
    signal,
    retry: false,
    headers: { "x-fizz-workspace-id": workspaceId },
  };
}
export async function listContentReviews(
  workspaceId: string,
  generation: number,
  signal: AbortSignal
) {
  const config = await authorize(workspaceId, generation, signal);
  const result = z
    .object({ items: z.array(summary) })
    .parse(await api.get("/content-review/records", config));
  current(generation, signal);
  if (new Set(result.items.map((r) => r.id)).size !== result.items.length)
    throw new Error("Duplicate review records");
  return result.items;
}
export async function getContentReview(
  workspaceId: string,
  generation: number,
  id: string,
  signal: AbortSignal
) {
  z.string().uuid().parse(id);
  const config = await authorize(workspaceId, generation, signal);
  const result = contentReviewDetailSchema.parse(
    await api.get(`/content-review/records/${id}`, config)
  );
  current(generation, signal);
  if (result.id !== id) throw new Error("Content review record mismatch");
  return result;
}

export async function addContentReviewComment(
  workspaceId: string,
  generation: number,
  id: string,
  input: { seconds: number; body: string },
  signal: AbortSignal
) {
  z.string().uuid().parse(id);
  const data = z
    .object({
      seconds: z.number().finite().min(0).max(CONTENT_REVIEW_MAX_DURATION_SECONDS),
      body: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(input);
  const config = await authorize(workspaceId, generation, signal);
  const result = contentReviewDetailSchema.parse(
    await api.post(`/content-review/records/${id}/comments`, { ...config, data })
  );
  current(generation, signal);
  if (
    result.id !== id ||
    !result.comments.some(
      (comment) => comment.seconds === data.seconds && comment.body === data.body
    )
  )
    throw new Error("Comment receipt mismatch. Refresh the report before retrying.");
  return result;
}

export async function getContentReviewPlayback(
  workspaceId: string,
  generation: number,
  recordId: string,
  signal: AbortSignal
) {
  const record = await getContentReview(workspaceId, generation, recordId, signal);
  const access = await fetchCrewAssetAccess(record.mediaAssetId, signal);
  current(generation, signal);
  return access;
}

export async function exportContentReview(
  workspaceId: string,
  generation: number,
  recordId: string,
  signal: AbortSignal
) {
  const record = await getContentReview(workspaceId, generation, recordId, signal);
  const result = await api.post<ApiBinaryResponse>("/api/user/video/moderation/ai/exportExcel", {
    service: "studio",
    responseType: "binary",
    retry: false,
    timeout: 60_000,
    signal,
    data: {
      overview: record.overview,
      details: record.details,
      fileName: record.exportFileName || record.fileName,
    },
  });
  current(generation, signal);
  // XLSX is a ZIP container. Reject JSON/HTML/error pages masquerading as downloads.
  const bytes = new Uint8Array(result.bytes);
  if (
    !/^(application\/(vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|octet-stream|zip))(;|$)/i.test(
      result.contentType
    ) ||
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 3 ||
    bytes[3] !== 4
  )
    throw new Error("Invalid Excel report response");
  const filename = reportFilename(result.disposition, record.exportFileName || record.fileName);
  return { bytes, filename };
}
export function reportFilename(disposition: string | null, fallback: string) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let name =
    disposition
      ?.match(/filename="([^"\r\n]+)"|filename=([^;\r\n]+)/i)
      ?.slice(1)
      .find(Boolean) || fallback;
  if (encoded) {
    try {
      name = decodeURIComponent(encoded);
    } catch {
      /* Use plain filename. */
    }
  }
  name = name
    .split(/[\\/]/)
    .pop()!
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 140);
  return (name.replace(/\.(xlsx|mp4|mov|webm)$/i, "") || "video-moderation") + ".xlsx";
}
