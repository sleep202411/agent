import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import type { TimelineScope } from "./story-timeline-api";
const id = z.string().uuid(),
  version = z.number().int().nonnegative();
const identifier = z.string().trim().min(1).max(180);
const scalar = z.union([z.boolean(), z.number().finite(), identifier]);
const reserved = new Set([
  "prompt",
  "negativeprompt",
  "promptdocument",
  "referenceimages",
  "referencevideos",
  "referenceaudios",
  "startframe",
  "endframe",
  "firstframe",
  "lastframe",
  "maskimage",
  "inputimage",
  "inputvideo",
  "imagereference",
  "videoreference",
  "audioreference",
]);
export const timelineGenerationInput = z
  .object({
    expectedVersion: version,
    modelId: identifier.optional(),
    schemaVersion: identifier.optional(),
    options: z
      .record(z.string().trim().min(1).max(120), z.union([scalar, z.array(scalar).max(32)]))
      .superRefine((options, context) => {
        for (const [key, value] of Object.entries(options)) {
          const canonical = key.replace(/[_-]/g, "").toLowerCase();
          if (canonical === "omnireferencetasktype") continue;
          if (
            reserved.has(canonical) ||
            canonical.includes("reference") ||
            canonical.endsWith("frame") ||
            canonical.includes("mask")
          ) {
            context.addIssue({
              code: "custom",
              path: [key],
              message: "Prompts and references belong to the saved clip.",
            });
          } else if (
            (Array.isArray(value) ? value : [value]).some(
              (v) => typeof v === "string" && /^(https?:|asset:|data:|blob:|file:)/i.test(v)
            )
          ) {
            context.addIssue({
              code: "custom",
              path: [key],
              message: "Generation options cannot contain media URLs.",
            });
          }
        }
      })
      .default({}),
  })
  .strict()
  .refine(
    (v) => Boolean(v.modelId) === Boolean(v.schemaVersion),
    "Select both model and schema version."
  );
const common = { clientKey: id };
const commandSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("create"), input: timelineGenerationInput }).strict(),
  z
    .object({
      ...common,
      action: z.literal("retry"),
      generationId: id,
      input: z.object({ expectedVersion: version }).strict(),
    })
    .strict(),
  z.object({ ...common, action: z.literal("cancel"), generationId: id }).strict(),
  z.object({ ...common, action: z.literal("attach"), generationId: id }).strict(),
]);
export type TimelineGenerationCommand = z.input<typeof commandSchema>;
export type TimelineGenerationScope = TimelineScope & { sequenceId: string; clipId: string };
export const timelineGenerationReceiptSchema = z
  .object({
    id,
    projectId: id,
    chapterId: id,
    target: z.object({ kind: z.literal("storyboard_clip"), id, sequenceId: id }),
    targetVersion: version,
    outputKind: z.enum(["image", "video"]),
    retryOfGenerationId: id.nullable(),
    aiJob: z
      .object({
        id,
        modelId: identifier,
        schemaVersion: identifier,
        status: z.enum([
          "created",
          "in_queue",
          "in_progress",
          "completed",
          "failed",
          "cancelled",
          "expired",
        ]),
        stage: z.string(),
        progress: z.number().finite().nullable(),
        error: z.unknown(),
      })
      .passthrough(),
    materialization: z
      .object({
        status: z.enum(["waiting_for_job", "pending", "completed", "failed"]),
        canRetry: z.boolean(),
        attempts: version,
        error: z.unknown(),
        retryUrl: z.string(),
      })
      .passthrough(),
    statusUrl: z.string(),
    cancelUrl: z.string(),
    retryUrl: z.string(),
    mediaVersions: z.array(z.object({ id, mediaAssetId: id }).passthrough()),
  })
  .passthrough();
export type TimelineGeneration = z.infer<typeof timelineGenerationReceiptSchema>;
function current(scope: TimelineGenerationScope, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (scope.generation !== getAuthGeneration()) throw Error("Timeline generation session expired.");
  [scope.projectId, scope.chapterId, scope.sequenceId, scope.clipId].forEach((v) => id.parse(v));
}
function path(scope: TimelineGenerationScope) {
  return `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/storyboard/sequences/${scope.sequenceId}/clips/${scope.clipId}/generations`;
}
function receipt(scope: TimelineGenerationScope, raw: unknown, generationId?: string) {
  current(scope);
  const value = timelineGenerationReceiptSchema.parse(raw);
  const url = `/aurora${path(scope)}/${value.id}`;
  if (
    value.projectId !== scope.projectId ||
    value.chapterId !== scope.chapterId ||
    value.target.id !== scope.clipId ||
    value.target.sequenceId !== scope.sequenceId ||
    (generationId && value.id !== generationId) ||
    value.statusUrl !== url ||
    value.cancelUrl !== `${url}/cancel` ||
    value.retryUrl !== `${url}/retry` ||
    value.materialization.retryUrl !== `${url}/materialization/retry`
  )
    throw Error("Generation response does not match the requested clip.");
  return value;
}
export async function getTimelineGeneration(
  scope: TimelineGenerationScope,
  generationId: string,
  signal: AbortSignal
) {
  current(scope, signal);
  id.parse(generationId);
  const raw = await api.get(`${path(scope)}/${generationId}`, {
    service: "aurora",
    retry: false,
    signal,
  });
  current(scope, signal);
  return receipt(scope, raw, generationId);
}
/** Commands are retried only explicitly, using their original body and idempotency key. */
export function timelineGenerationPending(
  scope: TimelineGenerationScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-timeline-generation",
    userId,
    `${scope.projectId}:${scope.chapterId}:${scope.sequenceId}:${scope.clipId}`
  )
) {
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  return {
    ...pending,
    submit: async (raw: TimelineGenerationCommand) => {
      current(scope);
      const command = commandSchema.parse(raw);
      pending.save(command);
      const suffix =
        command.action === "create"
          ? ""
          : `/${command.generationId}/${command.action === "attach" ? "materialization/retry" : command.action}`;
      const value = receipt(
        scope,
        await api.post(`${path(scope)}${suffix}`, {
          service: "aurora",
          retry: false,
          ...(command.action === "cancel"
            ? {}
            : { headers: { "Idempotency-Key": `timeline-generation:${command.clientKey}` } }),
          ...("input" in command ? { data: command.input } : {}),
        }),
        command.action === "cancel" || command.action === "attach"
          ? command.generationId
          : undefined
      );
      if ("input" in command && value.targetVersion !== command.input.expectedVersion)
        throw Error("Generation target version could not be verified. Retry the saved request.");
      if (
        command.action === "retry" &&
        (value.retryOfGenerationId !== command.generationId || value.id === command.generationId)
      )
        throw Error("Generation retry receipt could not be verified.");
      if (
        command.action === "create" &&
        (value.retryOfGenerationId !== null ||
          (command.input.modelId &&
            (value.aiJob.modelId !== command.input.modelId ||
              value.aiJob.schemaVersion !== command.input.schemaVersion)))
      )
        throw Error("Generation model receipt could not be verified.");
      pending.clear(command.clientKey);
      return value;
    },
  };
}
