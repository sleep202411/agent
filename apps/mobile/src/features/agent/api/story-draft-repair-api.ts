import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";

const id = z.string().uuid();
const schemaVersion = "interactive-story-draft-v1";
// Keep fields outside the focused editor intact, including future authoring fields.
const contentSchema = z
  .object({
    graph: z
      .object({
        entryNodeId: z.string().nullable(),
        nodes: z.array(z.object({ nodeId: z.string().min(1) }).passthrough()),
      })
      .passthrough(),
  })
  .passthrough();
const draftSchema = z.object({
  projectId: id,
  chapterId: id,
  schemaVersion: z.literal(schemaVersion),
  revision: z.number().int().nonnegative(),
  content: contentSchema,
  updatedBySessionId: z.string().nullable(),
});
const commandSchema = z.object({
  clientKey: id,
  input: z.object({
    schemaVersion: z.literal(schemaVersion),
    expectedRevision: z.number().int().nonnegative(),
    sessionId: id,
    content: contentSchema,
  }),
});
export const parseStoryRepairCommand = (value: unknown) => commandSchema.parse(value);
export type StoryRepairDraft = z.infer<typeof draftSchema>;
export type StoryRepairCommand = z.infer<typeof commandSchema>;
export type StoryRepairScope = { projectId: string; chapterId: string; generation: number };

function current(scope: StoryRepairScope, signal?: AbortSignal) {
  id.parse(scope.projectId);
  id.parse(scope.chapterId);
  signal?.throwIfAborted();
  if (scope.generation !== getAuthGeneration()) throw Error("Story repair session expired.");
}
function parseDraft(scope: StoryRepairScope, value: unknown) {
  const draft = draftSchema.parse(value);
  if (draft.projectId !== scope.projectId || draft.chapterId !== scope.chapterId)
    throw Error("Story repair chapter mismatch.");
  return draft;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function loadStoryRepairDraft(scope: StoryRepairScope, signal: AbortSignal) {
  current(scope, signal);
  const response = z
    .object({
      project: z.object({
        id,
        defaultLocale: z.string().trim().min(1),
        frameProfile: z.enum(["landscape_16_9", "portrait_9_16"]).optional(),
        durationPreset: z.string().nullable().optional(),
        visualStyle: z.string().nullable().optional(),
        capabilities: z.array(z.string()),
      }),
      chapter: z.object({ id }),
      draft: z.unknown(),
    })
    .parse(
      await api.get(`/story-projects/${scope.projectId}/workbench`, {
        service: "aurora",
        params: { chapterId: scope.chapterId },
        signal,
        retry: false,
      })
    );
  current(scope, signal);
  if (response.project.id !== scope.projectId || response.chapter.id !== scope.chapterId)
    throw Error("Story repair workspace mismatch.");
  if (!response.project.capabilities.includes("story.read"))
    throw Error("Story reading permission is required.");
  return {
    draft: parseDraft(scope, response.draft),
    defaultLocale: response.project.defaultLocale,
    frameProfile: response.project.frameProfile,
    creativeProfile: {
      frameProfile: response.project.frameProfile,
      durationPreset: response.project.durationPreset,
      visualStyle: response.project.visualStyle,
      defaultLocale: response.project.defaultLocale,
    },
    canEdit: response.project.capabilities.includes("story.edit"),
    canGenerate: response.project.capabilities.includes("story.generate"),
  };
}

/** Unknown writes stay durable until an exact read or receipt verifies the desired content. */
export function storyRepairPending(
  scope: StoryRepairScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-draft-repair",
    userId,
    `${scope.projectId}:${scope.chapterId}`
  )
) {
  if (!userId) throw Error("An account is required.");
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  let saving = false;
  const idle = () => {
    if (saving) throw Error("A Story repair save is already in progress.");
  };
  const matches = (draft: StoryRepairDraft, command: StoryRepairCommand) =>
    canonical(draft.content) === canonical(command.input.content);
  return {
    read: pending.read,
    // Explicit user discard only; the UI must show both saved and local content first.
    discard: (clientKey: string) => {
      idle();
      pending.clear(clientKey);
    },
    async reconcile(signal: AbortSignal) {
      idle();
      current(scope, signal);
      const command = pending.read();
      const loaded = await loadStoryRepairDraft(scope, signal);
      const applied =
        !!command &&
        loaded.draft.revision >= command.input.expectedRevision &&
        matches(loaded.draft, command);
      if (applied) pending.clear(command!.clientKey);
      return { ...loaded, applied, pending: applied ? null : command };
    },
    async save(value: StoryRepairCommand, signal: AbortSignal) {
      idle();
      saving = true;
      try {
        current(scope, signal);
        const command = commandSchema.parse(value);
        pending.save(command);
        const loaded = await loadStoryRepairDraft(scope, signal);
        if (!loaded.canEdit) throw Error("Story editing permission is required.");
        if (
          matches(loaded.draft, command) &&
          loaded.draft.revision >= command.input.expectedRevision
        ) {
          pending.clear(command.clientKey);
          return loaded.draft;
        }
        if (loaded.draft.revision !== command.input.expectedRevision)
          throw Error("The draft changed. Review the saved chapter before applying your repair.");
        const result = await api.put(
          `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/draft`,
          {
            service: "aurora",
            data: command.input,
            signal,
            retry: false,
          }
        );
        current(scope, signal);
        const draft = parseDraft(scope, result);
        if (
          draft.revision !== command.input.expectedRevision + 1 ||
          draft.updatedBySessionId !== command.input.sessionId ||
          !matches(draft, command)
        )
          throw Error(
            "The repair receipt could not be verified. Reload the saved chapter before retrying."
          );
        pending.clear(command.clientKey);
        return draft;
      } finally {
        saving = false;
      }
    },
  };
}
