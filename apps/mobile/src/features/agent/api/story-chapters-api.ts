import { z } from "zod";
import { scriptCheckpointSchema } from "../../../../script-editor/protocol";
import { scriptUpdatePending } from "./story-script-collaboration";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid();
const version = z.number().int().nonnegative();
const title = z.string().trim().min(1).max(160);
const chapterSchema = z.object({
  id,
  projectId: id,
  title: z.string(),
  rank: version,
  nodeCount: version,
});
const ids = z
  .array(id)
  .min(1)
  .max(200)
  .refine((v) => new Set(v).size === v.length);
const base = { clientKey: id, expectedProjectVersion: version };
const commandSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("create"), title, previousIds: ids }).strict(),
  z.object({ ...base, kind: z.literal("rename"), chapterId: id, title }).strict(),
  z.object({ ...base, kind: z.literal("order"), chapterIds: ids }).strict(),
  z.object({ ...base, kind: z.literal("archive"), chapterId: id }).strict(),
]);
export type ChapterCommand = z.infer<typeof commandSchema>;
export type ManagedStoryChapter = z.infer<typeof chapterSchema>;
export type ChapterScope = { projectId: string; generation: number };
export function storyChapters(
  scope: ChapterScope,
  userId: string,
  storage: DurableRecord = durableRecord("story-chapter-command", userId, scope.projectId)
) {
  if (!userId) throw Error("An account is required.");
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  let busy = false;
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    if (getAuthGeneration() !== scope.generation) throw Error("Story session expired.");
  };
  const read = async (signal: AbortSignal) => {
    current(signal);
    const value = z
      .object({
        project: z.object({ id, projectVersion: version, capabilities: z.array(z.string()) }),
        chapters: z.array(chapterSchema).min(1).max(200),
      })
      .parse(
        await api.get(`/story-projects/${scope.projectId}/workbench`, {
          service: "aurora",
          signal,
          retry: false,
        })
      );
    current(signal);
    if (
      value.project.id !== scope.projectId ||
      value.chapters.some((c) => c.projectId !== scope.projectId) ||
      new Set(value.chapters.map((c) => c.id)).size !== value.chapters.length
    )
      throw Error("Chapter project identity mismatch.");
    if (!value.project.capabilities.includes("story.read"))
      throw Error("Story reading permission is required.");
    return value;
  };
  type State = Awaited<ReturnType<typeof read>>;
  const applied = (s: State, c: ChapterCommand) =>
    s.project.projectVersion > c.expectedProjectVersion &&
    (c.kind === "rename"
      ? s.chapters.some((row) => row.id === c.chapterId && row.title === c.title)
      : c.kind === "archive"
        ? !s.chapters.some((row) => row.id === c.chapterId)
        : c.kind === "order"
          ? JSON.stringify(s.chapters.map((row) => row.id)) === JSON.stringify(c.chapterIds)
          : false);
  return {
    pending: pending.read,
    discard(key: string) {
      if (busy) throw Error("A chapter update is in progress.");
      pending.clear(key);
    },
    async load(signal: AbortSignal) {
      const state = await read(signal),
        command = pending.read();
      const reconciled = !!command && applied(state, command);
      if (reconciled) pending.clear(command!.clientKey);
      return { ...state, pending: reconciled ? null : command, reconciled };
    },
    async selectCreated(chapterId: string, signal: AbortSignal) {
      const state = await read(signal),
        command = pending.read();
      if (
        command?.kind !== "create" ||
        !state.chapters.some(
          (c) =>
            c.id === chapterId && c.title === command.title && !command.previousIds.includes(c.id)
        )
      )
        throw Error("This chapter cannot resolve the pending creation.");
      pending.clear(command.clientKey);
      return state;
    },
    async save(raw: ChapterCommand, signal: AbortSignal) {
      if (busy) throw Error("A chapter update is in progress.");
      busy = true;
      try {
        current(signal);
        const command = commandSchema.parse(raw),
          previous = pending.read();
        if (previous && JSON.stringify(previous) !== JSON.stringify(command))
          throw Error("Resolve the pending chapter update first.");
        const state = await read(signal);
        if (applied(state, command)) {
          pending.clear(command.clientKey);
          return { state, chapterId: undefined };
        }
        if (previous?.kind === "create")
          throw Error(
            "Creation may already have succeeded. Review the chapter list before creating again."
          );
        if (!state.project.capabilities.includes("story.edit"))
          throw Error("Story editing permission is required.");
        if (state.project.projectVersion !== command.expectedProjectVersion)
          throw Error("The project changed. Reload before changing chapters.");
        if (
          command.kind === "create" &&
          (state.chapters.length >= 200 ||
            JSON.stringify(state.chapters.map((c) => c.id)) !== JSON.stringify(command.previousIds))
        )
          throw Error("The chapter list changed or reached its limit. Reload first.");
        if (
          command.kind === "order" &&
          JSON.stringify([...command.chapterIds].sort()) !==
            JSON.stringify(state.chapters.map((c) => c.id).sort())
        )
          throw Error("Chapter order must include every active chapter exactly once.");
        if (command.kind === "rename" || command.kind === "archive") {
          const chapter = state.chapters.find((c) => c.id === command.chapterId);
          if (!chapter) throw Error("This chapter is no longer available.");
          if (command.kind === "archive") {
            if (state.chapters.length === 1 || chapter.nodeCount > 0)
              throw Error("Only empty chapters can be archived, and one chapter must remain.");
            // The selected chapter may have Script edits even when it has no scenes.
            // Read its existing document identity without ensuring/creating a document.
            const focused = z
              .object({
                project: z.object({ id, projectVersion: version }),
                chapter: chapterSchema,
                script: z.object({ documentId: id.nullable() }),
              })
              .parse(
                await api.get(`/story-projects/${scope.projectId}/workbench`, {
                  service: "aurora",
                  signal,
                  retry: false,
                  params: { chapterId: chapter.id },
                })
              );
            current(signal);
            if (
              focused.project.id !== scope.projectId ||
              focused.chapter.projectId !== scope.projectId ||
              focused.chapter.id !== chapter.id
            )
              throw Error("Chapter project identity mismatch.");
            if (
              focused.project.projectVersion !== command.expectedProjectVersion ||
              focused.chapter.nodeCount > 0
            )
              throw Error("The chapter changed. Reload before archiving.");
            if (focused.script.documentId) {
              const identity = `${scope.projectId}:${chapter.id}:${focused.script.documentId}`;
              const rawCheckpoint = durableRecord(
                "story-script-checkpoint",
                userId,
                identity
              ).read();
              const checkpoint =
                rawCheckpoint === null
                  ? undefined
                  : scriptCheckpointSchema.parse(JSON.parse(rawCheckpoint));
              const scriptCommand = scriptUpdatePending(
                { ...scope, chapterId: chapter.id, documentId: focused.script.documentId },
                userId
              ).read();
              if (checkpoint?.pending.length || scriptCommand)
                throw Error(
                  "Open this chapter's Script and finish syncing its local edits before archiving."
                );
            }
            const draft = durableRecord(
              "story-repair-draft",
              userId,
              `${scope.projectId}:${chapter.id}`
            ).read();
            if (draft && draft !== "null")
              throw Error("Save or discard this chapter's local graph edits before archiving.");
            const pendingGraph = durableRecord(
              "story-draft-repair",
              userId,
              `${scope.projectId}:${chapter.id}`
            ).read();
            if (pendingGraph && JSON.parse(pendingGraph)?.intent)
              throw Error("Resolve this chapter's pending graph save before archiving.");
          }
        }
        pending.save(command);
        const options = { service: "aurora" as const, signal, retry: false as const };
        const path = `/story-projects/${scope.projectId}/chapters`;
        let selected: string | undefined;
        if (command.kind === "order") {
          const result = z.array(chapterSchema).parse(
            await api.put(`${path}/order`, {
              ...options,
              data: {
                expectedProjectVersion: command.expectedProjectVersion,
                chapterIds: command.chapterIds,
              },
            })
          );
          if (
            JSON.stringify(result.map((c) => c.id)) !== JSON.stringify(command.chapterIds) ||
            result.some((c) => c.projectId !== scope.projectId)
          )
            throw Error("Chapter order receipt mismatch.");
        } else {
          const result = chapterSchema.parse(
            command.kind === "create"
              ? await api.post(path, { ...options, data: { title: command.title } })
              : command.kind === "rename"
                ? await api.patch(`${path}/${command.chapterId}`, {
                    ...options,
                    data: { title: command.title },
                  })
                : await api.post(`${path}/${command.chapterId}/archive`, { ...options, data: {} })
          );
          current(signal);
          if (
            result.projectId !== scope.projectId ||
            (command.kind !== "create" && result.id !== command.chapterId) ||
            (command.kind !== "archive" && result.title !== command.title) ||
            (command.kind === "create" && command.previousIds.includes(result.id))
          )
            throw Error("Chapter receipt mismatch.");
          if (command.kind === "create") selected = result.id;
        }
        const updated = await read(signal);
        if (
          command.kind === "create"
            ? !updated.chapters.some((c) => c.id === selected && c.title === command.title)
            : !applied(updated, command)
        )
          throw Error("Chapter update could not be verified. Reload before retrying.");
        pending.clear(command.clientKey);
        return { state: updated, chapterId: selected };
      } finally {
        busy = false;
      }
    },
  };
}
