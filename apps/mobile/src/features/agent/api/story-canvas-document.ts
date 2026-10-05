import { z } from "zod";
import { synchronizeCanvasHistory, type CanvasDocumentState } from "./canvas-document-history";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import type { CandidateScope } from "./story-candidates-api";

/** Matches Web CANVAS_ROOT_SCHEMA and Server document-modes.ts. */
export { CANVAS_ROOTS as STORY_CANVAS_ROOTS } from "../../../../canvas-editor/schema";
const id = z.string().uuid();
const sequence = z.number().int().nonnegative();
const base64 = z
  .string()
  .min(4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const documentSchema = z
  .object({
    id,
    owner: z.object({ kind: z.literal("story_project"), projectId: id }),
    storyProjectId: id,
    platformProjectId: z.null(),
    storyChapterId: z.null(),
    type: z.literal("canvas"),
    status: z.literal("active"),
    currentSequence: sequence,
    snapshotSequence: sequence,
    crdtStateBase64: base64,
  })
  .refine(
    (value) => value.snapshotSequence <= value.currentSequence,
    "Invalid canvas snapshot horizon."
  );
export type { CanvasHistoryOperation as StoryCanvasOperation } from "./canvas-document-history";
export type StoryCanvasDocumentState = CanvasDocumentState<CanvasDocument>;
type CanvasDocument = z.infer<typeof documentSchema>;
function current(scope: CandidateScope, signal: AbortSignal) {
  signal.throwIfAborted();
  id.parse(scope.projectId);
  if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
}
function parseDocument(scope: CandidateScope, raw: unknown, expectedId?: string) {
  const document = z.object({ document: documentSchema }).parse(raw).document;
  if (
    document.storyProjectId !== scope.projectId ||
    document.owner.projectId !== scope.projectId ||
    (expectedId && document.id !== expectedId)
  )
    throw Error("Canvas document scope mismatch.");
  return document;
}
export async function readStoryCanvasDocument(
  scope: CandidateScope,
  documentId: string,
  signal: AbortSignal
) {
  current(scope, signal);
  id.parse(documentId);
  const raw = await api.get(`/documents/${documentId}`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(scope, signal);
  return parseDocument(scope, raw, documentId);
}
function synchronize(scope: CandidateScope, initial: CanvasDocument, signal: AbortSignal) {
  return synchronizeCanvasHistory(
    initial,
    signal,
    () => current(scope, signal),
    (documentId) => readStoryCanvasDocument(scope, documentId, signal)
  );
}
/** Explicit workbench opening uses Web's idempotent bootstrap. The Server permits
 * readers to open an existing document; creating one still requires story.edit.
 * Consumers must hydrate the binary state and replay operations before rendering;
 * contentSnapshot is deliberately excluded because it may be stale. */
export async function openStoryCanvasDocument(scope: CandidateScope, signal: AbortSignal) {
  current(scope, signal);
  const raw = await api.post(`/story-projects/${scope.projectId}/documents/canvas/ensure`, {
    service: "aurora",
    data: {},
    signal,
    retry: false,
  });
  current(scope, signal);
  return synchronize(scope, parseDocument(scope, raw), signal);
}
export async function reloadStoryCanvasDocument(
  scope: CandidateScope,
  documentId: string,
  signal: AbortSignal
) {
  return synchronize(scope, await readStoryCanvasDocument(scope, documentId, signal), signal);
}
