import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { canvasUpdateSchema, encodedCanvasState } from "../../../../canvas-editor/protocol";
import { fetchPlatformSections } from "./platform-sections-api";
import { synchronizeCanvasHistory, type CanvasDocumentState } from "./canvas-document-history";

const id = z.string().uuid();
const scopeSchema = z
  .object({
    kind: z.literal("platform"),
    workspaceId: id,
    projectId: id,
    sectionId: id,
    documentId: id,
    generation: z.number().int().nonnegative(),
  })
  .strict();
export type PlatformCanvasScope = z.infer<typeof scopeSchema>;
const documentSchema = z
  .object({
    id,
    workspaceId: id,
    sectionId: id,
    owner: z.object({ kind: z.literal("platform_project"), projectId: id }),
    platformProjectId: id,
    storyProjectId: z.null(),
    storyChapterId: z.null(),
    type: z.literal("canvas"),
    status: z.literal("active"),
    currentSequence: z.number().int().nonnegative(),
    snapshotSequence: z.number().int().nonnegative(),
    crdtStateBase64: encodedCanvasState,
  })
  .refine(
    (value) => value.snapshotSequence <= value.currentSequence,
    "Invalid canvas snapshot horizon."
  );
type PlatformCanvasDocument = z.infer<typeof documentSchema>;
export type PlatformCanvasDocumentState = CanvasDocumentState<PlatformCanvasDocument>;
function current(scope: PlatformCanvasScope, signal: AbortSignal) {
  signal.throwIfAborted();
  if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
}
/** Verify the live section-to-document mapping, not a cached project card. */
export async function readPlatformCanvasDocument(
  rawScope: PlatformCanvasScope,
  signal: AbortSignal,
  requireEdit = false
) {
  const scope = scopeSchema.parse(rawScope);
  current(scope, signal);
  const sections = await fetchPlatformSections(
    scope.projectId,
    scope.workspaceId,
    scope.generation,
    signal
  );
  current(scope, signal);
  const section = sections.sections.find((row) => row.id === scope.sectionId);
  if (!section || section.canvasDocumentId !== scope.documentId)
    throw Error("Canvas no longer belongs to the selected chapter.");
  if (requireEdit && !sections.canEdit) throw Error("Canvas editor permission is required.");
  const raw = await api.get(`/documents/${scope.documentId}`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(scope, signal);
  const document = z.object({ document: documentSchema }).parse(raw).document;
  if (
    document.id !== scope.documentId ||
    document.workspaceId !== scope.workspaceId ||
    document.sectionId !== scope.sectionId ||
    document.platformProjectId !== scope.projectId ||
    document.owner.projectId !== scope.projectId
  )
    throw Error("Canvas document scope mismatch.");
  return document;
}
export async function openPlatformCanvasDocument(
  rawScope: PlatformCanvasScope,
  signal: AbortSignal
): Promise<PlatformCanvasDocumentState> {
  const scope = scopeSchema.parse(rawScope);
  const initial = await readPlatformCanvasDocument(scope, signal);
  return synchronizeCanvasHistory(
    initial,
    signal,
    () => current(scope, signal),
    () => readPlatformCanvasDocument(scope, signal)
  );
}
const receiptSchema = z.object({
  operation: z.object({
    id,
    documentId: id,
    sequence: z.number().int().positive(),
    operationType: z.literal("yjs_update"),
    clientMutationId: id,
    yjsUpdateBase64: encodedCanvasState,
  }),
});

/** Keep exact bytes through transport failures, including after process restart.
 * Use a separate storage namespace from Story canvas drafts. */
export function platformCanvasUpdatePending(
  rawScope: PlatformCanvasScope,
  userId: string,
  storage?: DurableRecord
) {
  const scope = scopeSchema.parse(rawScope);
  const pending = pendingRequest(
    canvasUpdateSchema,
    scope.generation,
    storage ??
      durableRecord(
        "platform-canvas-update",
        userId,
        `${scope.workspaceId}:${scope.projectId}:${scope.sectionId}:${scope.documentId}`
      )
  );
  return {
    read: pending.read,
    submit: async (raw: z.infer<typeof canvasUpdateSchema>, signal: AbortSignal) => {
      current(scope, signal);
      const command = canvasUpdateSchema.parse(raw);
      pending.save(command);
      await readPlatformCanvasDocument(scope, signal, true);
      current(scope, signal);
      const rawReceipt = await api.post(`/documents/${scope.documentId}/operations`, {
        service: "aurora",
        retry: false,
        signal,
        data: {
          operationType: "yjs_update",
          clientMutationId: command.clientKey,
          idempotencyKey: `mobile-canvas:${command.clientKey}`,
          yjsUpdateBase64: command.yjsUpdateBase64,
        },
      });
      current(scope, signal);
      const receipt = receiptSchema.parse(rawReceipt).operation;
      if (
        receipt.documentId !== scope.documentId ||
        receipt.clientMutationId !== command.clientKey ||
        receipt.yjsUpdateBase64 !== command.yjsUpdateBase64
      )
        throw Error("Canvas update receipt mismatch. Retry the saved request.");
      pending.clear(command.clientKey);
      return receipt;
    },
  };
}
