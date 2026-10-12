import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { timelineClipSchema, type TimelineScope } from "./story-timeline-api";
const id = z.string().uuid();
export const candidateSchema = z.object({
  asset: z.object({
    id,
    kind: z.enum(["image", "video", "audio", "document", "other"]),
    status: z.enum(["uploading", "ready", "failed", "deleted"]),
    moderationStatus: z.enum(["unreviewed", "approved", "flagged", "blocked"]),
    contentType: z.string(),
    previewUrl: z.string().nullable(),
  }),
});
export type TimelineCandidate = z.infer<typeof candidateSchema>;
const inputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    sourceMediaAssetId: id,
    kind: z.enum(["image", "video"]),
    imagePrompt: z.string().trim().min(1).max(12000).nullable(),
    videoPrompt: z.string().trim().min(1).max(12000).nullable(),
  })
  .strict()
  .refine((v) =>
    v.kind === "image"
      ? v.imagePrompt !== null && v.videoPrompt === null
      : v.videoPrompt !== null && v.imagePrompt === null
  );
const commandSchema = z
  .object({ clientKey: id, sequenceId: id, clipId: id, input: inputSchema })
  .strict();
export type TimelineMediaCommand = z.infer<typeof commandSchema>;
function current(scope: TimelineScope, signal?: AbortSignal) {
  if (signal?.aborted || getAuthGeneration() !== scope.generation)
    throw Error("Timeline media session expired.");
  id.parse(scope.projectId);
  id.parse(scope.chapterId);
}
export async function fetchTimelineCandidates(scope: TimelineScope, signal: AbortSignal) {
  current(scope, signal);
  const values = z.array(candidateSchema).parse(
    await api.get(`/story-projects/${scope.projectId}/candidate-assets`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current(scope, signal);
  if (new Set(values.map((v) => v.asset.id)).size !== values.length)
    throw Error("Duplicate project media returned.");
  return values.filter(
    (v) =>
      ["image", "video"].includes(v.asset.kind) &&
      v.asset.status === "ready" &&
      v.asset.moderationStatus !== "blocked"
  );
}
export async function replaceTimelineMedia(scope: TimelineScope, raw: TimelineMediaCommand) {
  current(scope);
  const command = commandSchema.parse(raw);
  const result = timelineClipSchema
    .extend({
      selectedMediaVersion: z.object({ mediaAssetId: id, mediaKind: z.enum(["image", "video"]) }),
    })
    .parse(
      await api.patch(
        `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/storyboard/sequences/${command.sequenceId}/clips/${command.clipId}`,
        {
          service: "aurora",
          retry: false,
          headers: { "Idempotency-Key": `timeline-media:${command.clientKey}` },
          data: command.input,
        }
      )
    );
  current(scope);
  if (
    result.id !== command.clipId ||
    result.version !== command.input.expectedVersion + 1 ||
    result.kind !== command.input.kind ||
    result.imagePrompt !== command.input.imagePrompt ||
    result.videoPrompt !== command.input.videoPrompt ||
    result.selectedMediaVersion.mediaAssetId !== command.input.sourceMediaAssetId ||
    result.selectedMediaVersion.mediaKind !== command.input.kind
  )
    throw Error("Media replacement could not be verified. Retry the original request.");
  return result;
}
export function timelineMediaPending(
  scope: TimelineScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-timeline-media",
    userId,
    `${scope.projectId}:${scope.chapterId}`
  )
) {
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  return {
    ...pending,
    submit: async (command: TimelineMediaCommand) => {
      pending.save(command);
      const result = await replaceTimelineMedia(scope, command);
      pending.clear(command.clientKey);
      return result;
    },
  };
}
