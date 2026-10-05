import { skillSelection } from "./project-skills";
import {
  canvasGenerationFields,
  validCanvasGenerationScope,
  generationStorageKey,
  scopeFields,
  matchesGenerationScope,
  type GenerationStorageScope,
} from "./generation-scope";
import { z } from "zod";
import { referenceBinding, promptDocument, uniqueReferences } from "./reference-contract";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";

const id = z.string().uuid();
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(json),
    z.record(z.string(), json),
  ])
);
export const jobStatus = z.enum([
  "in_queue",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
export const generationCommand = z
  .object({
    clientKey: id,
    workspaceId: id.optional(),
    ...canvasGenerationFields,
    skillSelection: skillSelection.optional(),
    projectId: id.optional(),
    storyProjectId: id.optional(),
    modelId: z.string().min(1).optional(),
    presetId: z.string().min(1).optional(),
    campaignId: z.string().min(1).optional(),
    schemaVersion: z.string().min(1),
    input: z.record(z.string(), json),
    referenceBindings: z.array(referenceBinding).optional(),
    promptDocument: promptDocument.optional(),
  })
  .refine((v) => !(v.projectId && v.storyProjectId), "Choose one project context.")
  .refine(validCanvasGenerationScope, "Canvas generation requires a project, document and card.")
  .refine(
    (v) => !(v.projectId || v.storyProjectId) || !!v.workspaceId,
    "Project generation requires its workspace."
  )
  .refine(
    (v) => !v.skillSelection || !!(v.projectId || v.storyProjectId),
    "Skills require a project."
  )
  .refine((v) => Boolean(v.modelId || v.presetId), "Choose a model or preset.")
  .refine((v) => {
    const refs = v.referenceBindings ?? [];
    return (
      uniqueReferences(refs) &&
      (v.promptDocument?.nodes.every(
        (n) => n.type === "text" || refs.some((r) => r.refId === n.refId)
      ) ??
        true)
    );
  }, "Prompt references must match the attached media.");
export type GenerationCommand = z.infer<typeof generationCommand>;
const output = z
  .object({
    id: z.string().min(1),
    type: z.enum(["image", "video", "audio"]),
    url: z.string().url(),
    width: z.number().nullish(),
    height: z.number().nullish(),
    durationSeconds: z.number().nullish(),
    mimeType: z.string().nullish(),
  })
  .passthrough();
export const generationJob = z
  .object({
    id,
    idempotencyKey: z.string().optional(),
    type: z.enum(["image", "video", "audio"]),
    modelId: z.string().min(1),
    status: jobStatus,
    stage: z.string(),
    sourceSurface: z.string().nullish(),
    workspaceId: id.nullish(),
    projectId: id.nullish(),
    storyProjectId: id.nullish(),
    documentId: id.nullish(),
    documentBlockId: z.string().nullish(),
    prompt: z.string(),
    input: z.record(z.string(), z.unknown()).nullish(),
    outputs: z.array(output),
    progress: z.number().nullish(),
    queuePosition: z.number().nullish(),
    estimatedTotalSeconds: z.number().nullish(),
    schemaVersion: z.string().optional(),
    error: z.object({ userMessage: z.string(), retryable: z.boolean() }).passthrough().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export type GenerationJob = z.infer<typeof generationJob>;
const receipt = z.object({ request_id: id, status: jobStatus }).passthrough();
const jobList = z.object({ jobs: z.array(generationJob), nextCursor: z.string().nullable() });
export function generationSession(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Generation session expired.");
}
export function generationOutbox(
  userId: string,
  generation: number,
  storageScope?: GenerationStorageScope
) {
  return pendingRequest(
    generationCommand,
    generation,
    durableRecord("ai-lab-submit", userId, generationStorageKey(storageScope, "pending"))
  );
}
export async function listGenerationJobs(
  type: "image" | "video" | "audio",
  generation: number,
  signal: AbortSignal,
  workspaceId?: GenerationStorageScope
) {
  generationSession(generation, signal);
  // Official Web history is the most recent 80 jobs. Server currently returns
  // nextCursor:null; do not pretend that this is an exhaustive account archive.
  const value = jobList.parse(
    await api.get("/ai/jobs", {
      service: "aurora",
      signal,
      retry: false,
      params: { type, limit: 80, ...scopeFields(workspaceId) },
    })
  );
  generationSession(generation, signal);
  if (workspaceId && value.jobs.some((job) => !matchesGenerationScope(job, workspaceId)))
    throw new Error("Generation history does not match the selected workspace.");
  return value;
}
export async function getGenerationJob(
  jobId: string,
  generation: number,
  signal: AbortSignal,
  workspaceId?: GenerationStorageScope
) {
  generationSession(generation, signal);
  const value = generationJob.parse(
    await api.get(`/ai/jobs/${id.parse(jobId)}`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  generationSession(generation, signal);
  if (value.id !== jobId || (workspaceId && !matchesGenerationScope(value, workspaceId)))
    throw new Error("The generation receipt does not match this job or workspace.");
  return value;
}
export async function recoverGeneration(
  command: GenerationCommand,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const intent = generationCommand.parse(command);
  const value = jobList.parse(
    await api.get("/ai/jobs", {
      service: "aurora",
      signal,
      retry: false,
      params: {
        idempotencyKey: intent.clientKey,
        sourceSurface: intent.sourceSurface ?? "ai-lab",
        limit: 80,
        ...(intent.workspaceId
          ? scopeFields({
              workspaceId: intent.workspaceId,
              projectId: intent.projectId,
              storyProjectId: intent.storyProjectId,
              documentId: intent.documentId,
              documentBlockId: intent.documentBlockId,
              sourceSurface: intent.sourceSurface,
            })
          : {}),
      },
    })
  );
  generationSession(generation, signal);
  const matches = value.jobs.filter(
    (job) =>
      job.idempotencyKey === intent.clientKey &&
      job.sourceSurface === (intent.sourceSurface ?? "ai-lab") &&
      (!intent.workspaceId || matchesGenerationScope(job, intent as { workspaceId: string })) &&
      (!intent.modelId || job.modelId === intent.modelId)
  );
  if (matches.length !== value.jobs.length)
    throw new Error("The recovered generation does not match this request.");
  if (matches.length > 1) throw new Error("Multiple generation receipts need review.");
  return matches[0] ?? null;
}
export async function submitGeneration(
  command: GenerationCommand,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const { clientKey, ...input } = generationCommand.parse(command);
  const value = receipt.parse(
    await api.post("/ai/jobs", {
      service: "aurora",
      signal,
      retry: false,
      timeout: 30_000,
      data: { ...input, idempotencyKey: clientKey, sourceSurface: input.sourceSurface ?? "ai-lab" },
    })
  );
  generationSession(generation, signal);
  return value;
}
/** Save before any paid write; a lost response keeps the exact same request key. */
export async function submitPendingGeneration(
  command: GenerationCommand,
  userId: string,
  generation: number,
  signal: AbortSignal,
  storageScope?: GenerationStorageScope
) {
  generationSession(generation, signal);
  if (
    command.documentId &&
    (!storageScope ||
      !matchesGenerationScope(scopeFields(storageScope), command as { workspaceId: string }))
  )
    throw new Error("Canvas commands require their exact document and card storage scope.");
  if (storageScope && !matchesGenerationScope(command, storageScope))
    throw new Error("Submission does not match this workspace.");
  const outbox = generationOutbox(userId, generation, storageScope);
  outbox.save(command);
  const frozen = outbox.read()!;
  // Read before resubmit: catalogue/schema changes may reject a replay before
  // the server reaches its idempotency lookup. An existing receipt is enough.
  const existing = await recoverGeneration(frozen, generation, signal);
  const value = existing
    ? { request_id: existing.id, status: existing.status }
    : await submitGeneration(frozen, generation, signal);
  generationSession(generation, signal);
  outbox.clear(frozen.clientKey);
  return value;
}
export async function cancelGeneration(
  jobId: string,
  generation: number,
  signal: AbortSignal,
  workspaceId?: GenerationStorageScope
) {
  generationSession(generation, signal);
  if (workspaceId) await getGenerationJob(jobId, generation, signal, workspaceId);
  const value = generationJob.parse(
    await api.post(`/ai/jobs/${id.parse(jobId)}/cancel`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  generationSession(generation, signal);
  if (value.id !== jobId || !matchesGenerationScope(value, workspaceId))
    throw new Error("The cancellation receipt does not match this job or project.");
  return value;
}
// The official retry route recovers one child per original job, including legacy
// retry lineage. Persist the original target and retry only on explicit user action.

export const generationRetryCommand = z
  .object({
    clientKey: id,
    jobId: id,
    workspaceId: id.optional(),
    ...canvasGenerationFields,
    projectId: id.optional(),
    storyProjectId: id.optional(),
  })
  .refine((v) => !(v.projectId && v.storyProjectId), "Choose one project context.")
  .refine(validCanvasGenerationScope, "Canvas generation requires a project, document and card.")
  .refine(
    (v) => !(v.projectId || v.storyProjectId) || !!v.workspaceId,
    "Project generation requires its workspace."
  );
export type GenerationRetry = z.infer<typeof generationRetryCommand>;
export function generationRetryOutbox(
  userId: string,
  generation: number,
  storageScope?: GenerationStorageScope
) {
  return pendingRequest(
    generationRetryCommand,
    generation,
    durableRecord("ai-lab-retry", userId, generationStorageKey(storageScope, "pending"))
  );
}
/** Explicitly recover the original retry target using the server's stable lineage. */
export async function retryPendingGeneration(
  command: GenerationRetry,
  userId: string,
  generation: number,
  signal: AbortSignal,
  storageScope?: GenerationStorageScope
) {
  generationSession(generation, signal);
  if (
    command.documentId &&
    (!storageScope ||
      !matchesGenerationScope(scopeFields(storageScope), command as { workspaceId: string }))
  )
    throw new Error("Canvas commands require their exact document and card storage scope.");
  if (storageScope && !matchesGenerationScope(command, storageScope))
    throw new Error("Retry does not match this workspace.");
  const box = generationRetryOutbox(userId, generation, storageScope);
  const intent = generationRetryCommand.parse(command),
    previous = box.read();
  if (previous && JSON.stringify(previous) !== JSON.stringify(intent))
    throw new Error("Recover the saved generation retry before choosing another job.");
  if (intent.workspaceId)
    await getGenerationJob(
      intent.jobId,
      generation,
      signal,
      scopeFields(intent as { workspaceId: string }) as { workspaceId: string }
    );
  box.save(intent);
  const value = receipt.parse(
    await api.post(`/ai/jobs/${intent.jobId}/retry`, {
      service: "aurora",
      signal,
      retry: false,
      timeout: 30_000,
    })
  );
  generationSession(generation, signal);
  box.clear(intent.clientKey);
  return value;
}
