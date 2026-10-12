import { z } from "zod";
import {
  CONTENT_REVIEW_MAX_DURATION_SECONDS,
  contentReviewCreditsForDurationSeconds,
} from "@repo/shared";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchWorkspaceSettings } from "./studio-workspace-settings-api";
import { contentReviewDetailSchema } from "./content-review-api";
const uuid = z.string().uuid();
const duration = z.number().int().min(1).max(CONTENT_REVIEW_MAX_DURATION_SECONDS);
export const reviewChargeInput = z.object({ id: uuid, durationSeconds: duration }).strict();
export type ReviewChargeInput = z.infer<typeof reviewChargeInput>;
const receipt = z.object({ id: uuid, credits: z.number().int().nonnegative() });
const videoUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "A secure video URL is required");
const taskId = z.string().trim().min(1).max(512);
const overview = contentReviewDetailSchema.shape.overview.passthrough();
const details = z.array(contentReviewDetailSchema.shape.details.element.passthrough()).max(2000);
export const reviewResultSchema = z.object({
  overview,
  details,
  fileName: z.string().trim().min(1).max(256),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export const reviewSaveInput = z
  .object({
    mediaAssetId: uuid,
    chargeId: uuid,
    fileName: z.string().trim().min(1).max(256),
    exportFileName: z.string().trim().min(1).max(256),
    durationSeconds: duration,
    creditsCharged: z.number().int().positive(),
    overview,
    details,
  })
  .strict()
  .refine(
    (input) =>
      input.creditsCharged === contentReviewCreditsForDurationSeconds(input.durationSeconds),
    "Review credits do not match the duration"
  );
export type ReviewSaveInput = z.infer<typeof reviewSaveInput>;
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("Content review session expired");
}
async function authorize(workspaceId: string, generation: number, signal: AbortSignal) {
  uuid.parse(workspaceId);
  current(generation, signal);
  const workspace = await fetchWorkspaceSettings(workspaceId, generation, signal);
  current(generation, signal);
  if (
    workspace.id !== workspaceId ||
    workspace.status !== "active" ||
    workspace.accessScope !== "workspace" ||
    !["owner", "admin", "editor"].includes(workspace.role ?? "")
  )
    throw new Error("Workspace editor permission is required");
  return {
    service: "aurora" as const,
    signal,
    retry: false,
    headers: { "x-fizz-workspace-id": workspaceId },
  };
}
/** Caller persists the charge ID before sending. Never generate a replacement on retry. */
export async function chargeContentReview(
  workspaceId: string,
  generation: number,
  input: ReviewChargeInput,
  signal: AbortSignal
) {
  const data = reviewChargeInput.parse(input);
  const config = await authorize(workspaceId, generation, signal);
  const result = receipt.parse(await api.post("/content-review/charges", { ...config, data }));
  current(generation, signal);
  if (
    result.id !== data.id ||
    result.credits !== contentReviewCreditsForDurationSeconds(data.durationSeconds)
  )
    throw new Error("Content review charge receipt mismatch");
  return result;
}
/** Settlement confirms an existing non-refunded debit; it does not create another debit. */
export async function reconcileContentReviewCharge(
  workspaceId: string,
  generation: number,
  input: ReviewChargeInput,
  action: "settle" | "release",
  signal: AbortSignal
) {
  const data = reviewChargeInput.parse(input);
  z.enum(["settle", "release"]).parse(action);
  const config = await authorize(workspaceId, generation, signal);
  const result = receipt.parse(
    await api.post(`/content-review/charges/${data.id}/${action}`, { ...config, data: {} })
  );
  current(generation, signal);
  const expected = contentReviewCreditsForDurationSeconds(data.durationSeconds);
  if (
    result.id !== data.id ||
    (result.credits !== expected && !(action === "release" && result.credits === 0))
  )
    throw new Error("Content review charge receipt mismatch");
  return result;
}
/** Non-idempotent. Persist a submitting checkpoint first; never retry an unknown result. */
export async function submitContentReview(
  workspaceId: string,
  generation: number,
  url: string,
  signal: AbortSignal
) {
  const parsed = videoUrl.parse(url);
  await authorize(workspaceId, generation, signal);
  const result = z.object({ taskId }).parse(
    await api.post("/api/user/video/moderation/ai/submit", {
      service: "studio",
      retry: false,
      signal,
      timeout: 60_000,
      data: { url: parsed },
    })
  );
  current(generation, signal);
  return result.taskId;
}
/** One poll only, allowing the durable caller to suspend and resume the same job. */
export async function queryContentReview(
  workspaceId: string,
  generation: number,
  jobId: string,
  url: string,
  signal: AbortSignal
): Promise<
  | { status: "processing" }
  | { status: "success"; result: ReviewResult }
  | { status: "failed"; message: string }
> {
  const input = { taskId: taskId.parse(jobId), url: videoUrl.parse(url) };
  await authorize(workspaceId, generation, signal);
  const snapshot = z
    .object({
      taskId: taskId.nullable().optional(),
      status: z.string().nullable().optional(),
      message: z.string().nullable().optional(),
      overview: overview.nullable().optional(),
      details: details.nullable().optional(),
      fileName: z.string().nullable().optional(),
    })
    .parse(
      await api.post("/api/user/video/moderation/ai/query", {
        service: "studio",
        retry: false,
        signal,
        timeout: 30_000,
        data: input,
      })
    );
  current(generation, signal);
  if (snapshot.taskId && snapshot.taskId !== input.taskId)
    throw new Error("Content review job mismatch");
  const status = snapshot.status?.trim().toLowerCase();
  if (status === "failed")
    return { status: "failed", message: snapshot.message?.trim() || "Content review failed" };
  if (status === "success" || snapshot.overview)
    return {
      status: "success",
      result: reviewResultSchema.parse({
        overview: snapshot.overview,
        details: snapshot.details ?? [],
        fileName: snapshot.fileName || "video-moderation.xlsx",
      }),
    };
  if (!status || status === "processing") return { status: "processing" };
  throw new Error(snapshot.message?.trim() || "Unknown content review status");
}
/** The Server deduplicates saves by chargeId; retry the original input only. */
export async function saveContentReview(
  workspaceId: string,
  generation: number,
  input: ReviewSaveInput,
  signal: AbortSignal
) {
  const data = reviewSaveInput.parse(input);
  const config = await authorize(workspaceId, generation, signal);
  const result = contentReviewDetailSchema.parse(
    await api.post("/content-review/records", { ...config, data })
  );
  current(generation, signal);
  if (
    result.mediaAssetId !== data.mediaAssetId ||
    result.durationSeconds !== data.durationSeconds ||
    result.creditsCharged !== data.creditsCharged ||
    result.fileName !== data.fileName ||
    result.exportFileName !== data.exportFileName ||
    result.findingCount !== data.details.length ||
    JSON.stringify(result.overview) !==
      JSON.stringify(contentReviewDetailSchema.shape.overview.parse(data.overview)) ||
    JSON.stringify(result.details) !==
      JSON.stringify(contentReviewDetailSchema.shape.details.parse(data.details))
  )
    throw new Error("Saved review receipt mismatch");
  return result;
}
