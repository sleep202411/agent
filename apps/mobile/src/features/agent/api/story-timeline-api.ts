import { z } from "zod";
import {
  PutStoryStoryboardTimelineSchema,
  StoryProductionStableKeySchema,
  type PutStoryStoryboardTimelineInput,
} from "@repo/shared";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";

const id = z.string().uuid();
export const timelineClipSchema = z
  .object({
    id,
    stableKey: z.string(),
    title: z.string(),
    rank: z.number().int().nonnegative(),
    kind: z.enum(["image", "video"]),
    track: z.literal("visual"),
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    description: z.string().nullable(),
    imagePrompt: z.string().nullable(),
    videoPrompt: z.string().nullable(),
    negativePrompt: z.string().nullable(),
    status: z.literal("current"),
    version: z.number().int().nonnegative(),
  })
  .passthrough();
const sequenceSchema = z
  .object({
    id,
    projectId: id,
    chapterId: id,
    plotNodeId: z
      .string()
      .refine(
        (value) =>
          StoryProductionStableKeySchema.safeParse(value).success && value === value.trim(),
        "Invalid graph node identifier."
      ),
    title: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
    status: z.literal("current"),
    clips: z.array(timelineClipSchema),
  })
  .passthrough();
export type TimelineSequence = z.infer<typeof sequenceSchema>;
export type TimelineInput = PutStoryStoryboardTimelineInput;
export type TimelineScope = { projectId: string; chapterId: string; generation: number };

/** Retain identities and versions; only timing is recomputed after a reorder/resize. */
export function timelineDraft(sequence: TimelineSequence): TimelineInput {
  return PutStoryStoryboardTimelineSchema.parse({
    expectedVersion: sequence.version,
    durationMs: sequence.durationMs,
    clips: [...sequence.clips]
      .sort((a, b) => a.rank - b.rank)
      .map((clip) => ({
        id: clip.id,
        expectedVersion: clip.version,
        stableKey: clip.stableKey,
        title: clip.title,
        kind: clip.kind,
        startMs: clip.startMs,
        durationMs: clip.durationMs,
        description: clip.description,
        imagePrompt: clip.imagePrompt,
        videoPrompt: clip.videoPrompt,
        negativePrompt: clip.negativePrompt,
      })),
  });
}
export function reflowTimeline(
  expectedVersion: number,
  clips: TimelineInput["clips"]
): TimelineInput {
  let durationMs = 0;
  const ordered = clips.map((clip) => {
    const next = { ...clip, startMs: durationMs };
    durationMs += clip.durationMs;
    return next;
  });
  return PutStoryStoryboardTimelineSchema.parse({ expectedVersion, durationMs, clips: ordered });
}
function current(scope: TimelineScope, signal?: AbortSignal) {
  if (signal?.aborted || getAuthGeneration() !== scope.generation)
    throw Error("Timeline session expired.");
  id.parse(scope.projectId);
  id.parse(scope.chapterId);
}
function path(scope: TimelineScope) {
  return `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/storyboard`;
}
function parseSequence(value: unknown, scope: TimelineScope) {
  const sequence = sequenceSchema.parse(value);
  if (
    sequence.projectId !== scope.projectId ||
    sequence.chapterId !== scope.chapterId ||
    new Set(sequence.clips.map((clip) => clip.rank)).size !== sequence.clips.length
  )
    throw Error("Timeline response does not match this chapter.");
  timelineDraft(sequence); // Validate continuity, identities and prompt shape through the official contract.
  return sequence;
}
export async function fetchTimelines(scope: TimelineScope, signal: AbortSignal) {
  current(scope, signal);
  const raw = await api.get(path(scope), { service: "aurora", signal, retry: false });
  current(scope, signal);
  const sequences = z
    .array(z.unknown())
    .parse(raw)
    .map((value) => parseSequence(value, scope));
  if (
    new Set(sequences.map((sequence) => sequence.id)).size !== sequences.length ||
    new Set(sequences.map((sequence) => sequence.plotNodeId)).size !== sequences.length
  )
    throw Error("Duplicate timeline sequence returned.");
  return sequences;
}
/** Caller retains the exact input and key until this receipt is verified, including across retries. */
export async function saveTimeline(
  scope: TimelineScope,
  sequenceId: string,
  requestKey: string,
  input: TimelineInput
) {
  current(scope);
  id.parse(sequenceId);
  z.string().min(1).max(200).parse(requestKey);
  const data = PutStoryStoryboardTimelineSchema.parse(input);
  const raw = await api.put(`${path(scope)}/sequences/${sequenceId}/timeline`, {
    service: "aurora",
    retry: false,
    headers: { "Idempotency-Key": requestKey },
    data,
  });
  current(scope);
  const sequence = parseSequence(raw, scope);
  const returned = timelineDraft(sequence);
  const mismatch =
    sequence.id !== sequenceId ||
    sequence.version !== data.expectedVersion + 1 ||
    returned.durationMs !== data.durationMs ||
    returned.clips.length !== data.clips.length ||
    returned.clips.some((clip, index) => {
      const requested = data.clips[index]!;
      return (
        (requested.id && clip.id !== requested.id) ||
        clip.expectedVersion !== (requested.id ? requested.expectedVersion + 1 : 0) ||
        (
          [
            "stableKey",
            "title",
            "kind",
            "startMs",
            "durationMs",
            "description",
            "imagePrompt",
            "videoPrompt",
            "negativePrompt",
          ] as const
        ).some((key) => clip[key] !== requested[key])
      );
    });
  if (mismatch) throw Error("Timeline save could not be verified. Retry the original request.");
  return sequence;
}
