import { z } from "zod";
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
const operationSchema = z
  .object({
    id,
    documentId: id,
    sequence: sequence.positive(),
    operationType: z.enum(["yjs_update", "patch", "snapshot", "comment", "system"]),
    yjsUpdateBase64: base64.nullish(),
  })
  .refine(
    (value) => value.operationType !== "yjs_update" || !!value.yjsUpdateBase64,
    "Canvas update is missing CRDT data."
  );
type CanvasDocument = z.infer<typeof documentSchema>;
export type StoryCanvasOperation = z.infer<typeof operationSchema>;
export type StoryCanvasDocumentState = {
  document: CanvasDocument;
  operations: StoryCanvasOperation[];
  sequence: number;
};
class HorizonChanged extends Error {}
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
async function readDocument(scope: CandidateScope, documentId: string, signal: AbortSignal) {
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
async function replay(
  scope: CandidateScope,
  document: CanvasDocument,
  signal: AbortSignal
): Promise<StoryCanvasDocumentState> {
  const operations: StoryCanvasOperation[] = [],
    seen = new Set<string>();
  let cursor = document.snapshotSequence;
  while (cursor < document.currentSequence) {
    current(scope, signal);
    const raw = await api.get(`/documents/${document.id}/operations`, {
      service: "aurora",
      signal,
      retry: false,
      params: { afterSequence: cursor, limit: 500 },
    });
    current(scope, signal);
    const page = z.object({ operations: z.array(operationSchema).max(500) }).parse(raw).operations;
    if (!page.length) throw new HorizonChanged();
    for (const operation of page) {
      if (operation.documentId !== document.id || seen.has(operation.id))
        throw Error("Canvas operation identity mismatch.");
      if (operation.sequence !== cursor + 1) throw new HorizonChanged();
      if (operation.operationType === "patch" || operation.operationType === "snapshot")
        throw new HorizonChanged();
      seen.add(operation.id);
      operations.push(operation);
      cursor = operation.sequence;
      if (cursor === document.currentSequence) break;
    }
  }
  current(scope, signal);
  return { document, operations, sequence: cursor };
}
/** REST history can compact while loading. Restart from a fresh binary snapshot,
 * never combine a new horizon with the partially collected old operation list. */
async function synchronize(scope: CandidateScope, initial: CanvasDocument, signal: AbortSignal) {
  let document = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await replay(scope, document, signal);
    } catch (error) {
      if (!(error instanceof HorizonChanged)) throw error;
      if (attempt === 2) break;
      const fresh = await readDocument(scope, document.id, signal);
      if (fresh.currentSequence < document.currentSequence)
        throw Error("Canvas document sequence regressed.");
      document = fresh;
    }
  }
  throw Error("Canvas history changed during loading. Reload the document.");
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
  return synchronize(scope, await readDocument(scope, documentId, signal), signal);
}
