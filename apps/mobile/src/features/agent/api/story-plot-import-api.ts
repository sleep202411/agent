import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { parseStoryPlotImportValue, MAX_PLOT_IMPORT_CHAPTER_NODES } from "../lib/story-plot-import";
const id = z.string().uuid();
const version = "interactive-story-draft-v1";
const content = z
  .object({
    graph: z
      .object({
        entryNodeId: z.string().nullable(),
        nodes: z.array(z.object({ nodeId: z.string() }).passthrough()),
      })
      .passthrough(),
  })
  .passthrough();
const draftSchema = z.object({
  projectId: id,
  chapterId: id,
  schemaVersion: z.literal(version),
  revision: z.number().int().nonnegative(),
  content,
  updatedBySessionId: z.string().nullable(),
});
const inputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  schemaVersion: z.literal(version),
  content,
  sessionId: id,
  locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
  mode: z.enum(["append", "replace"]),
  plot: z.unknown().transform(parseStoryPlotImportValue),
});
const commandSchema = z.object({ clientKey: id, name: z.string().min(1), input: inputSchema });
export type PlotImportCommand = z.infer<typeof commandSchema>;
export type PlotImportDraft = z.infer<typeof draftSchema>;
export type PlotImportScope = { projectId: string; chapterId: string; generation: number };
function current(scope: PlotImportScope, signal?: AbortSignal) {
  id.parse(scope.projectId);
  id.parse(scope.chapterId);
  if (signal?.aborted || scope.generation !== getAuthGeneration())
    throw Error("Plot import session expired or request cancelled.");
}
function draftFor(scope: PlotImportScope, value: unknown) {
  const draft = draftSchema.parse(value);
  if (draft.projectId !== scope.projectId || draft.chapterId !== scope.chapterId)
    throw Error("Plot import chapter mismatch.");
  return draft;
}
export async function loadPlotImportDraft(scope: PlotImportScope, signal: AbortSignal) {
  current(scope, signal);
  const value = z
    .object({
      project: z.object({ id, capabilities: z.array(z.string()) }),
      chapter: z.object({ id }),
      draft: z.unknown(),
    })
    .parse(
      await api.get(`/story-projects/${scope.projectId}/workbench`, {
        service: "aurora",
        params: { chapterId: scope.chapterId },
        signal,
      })
    );
  current(scope, signal);
  if (value.project.id !== scope.projectId || value.chapter.id !== scope.chapterId)
    throw Error("Plot import workspace mismatch.");
  if (!value.project.capabilities.includes("story.edit"))
    throw Error("Story editing permission is required.");
  return draftFor(scope, value.draft);
}
export function plotImportPending(
  scope: PlotImportScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-plot-import",
    userId,
    `${scope.projectId}:${scope.chapterId}`
  )
) {
  if (!userId) throw Error("An account is required.");
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  return {
    read: pending.read,
    clear: pending.clear,
    async submit(command: PlotImportCommand, signal: AbortSignal) {
      current(scope, signal);
      // Never automatically repeat a non-idempotent import after an unknown outcome.
      if (pending.read())
        throw Error("Review the pending plot import before starting another import.");
      const intent = commandSchema.parse(command);
      const count =
        (intent.input.mode === "append" ? intent.input.content.graph.nodes.length : 0) +
        intent.input.plot.nodes.length;
      if (count > MAX_PLOT_IMPORT_CHAPTER_NODES)
        throw Error("A chapter supports at most 500 nodes.");
      pending.save(intent);
      const receipt = z
        .object({ draft: z.unknown(), importedNodeIds: z.array(z.string().min(1)) })
        .parse(
          await api.post(
            `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/plot-import`,
            { service: "aurora", data: intent.input, signal, timeout: 60000 }
          )
        );
      current(scope, signal);
      const draft = draftFor(scope, receipt.draft);
      const imported = new Set(receipt.importedNodeIds);
      if (
        draft.revision !== intent.input.expectedRevision + 1 ||
        draft.updatedBySessionId !== intent.input.sessionId ||
        imported.size !== intent.input.plot.nodes.length ||
        imported.size !== receipt.importedNodeIds.length ||
        !receipt.importedNodeIds.every((nodeId) =>
          draft.content.graph.nodes.some((n) => n.nodeId === nodeId)
        )
      )
        throw Error("Plot import receipt mismatch; review the current chapter.");
      pending.clear(intent.clientKey);
      return draft;
    },
  };
}
