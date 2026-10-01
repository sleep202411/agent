import { CONTENT_REVIEW_MAX_DURATION_SECONDS } from "@repo/shared";
import { z } from "zod";
import { api } from "@/lib/api-client";
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
const detail = summary.extend({
  exportFileName: z.string(),
  overview: z.object({
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
export type ContentReviewDetail = z.infer<typeof detail>;
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
  const result = detail.parse(await api.get(`/content-review/records/${id}`, config));
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
  const result = detail.parse(
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
