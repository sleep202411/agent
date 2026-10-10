import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import type { TimelineScope } from "./story-timeline-api";

const id = z.string().uuid();
const sequence = z.number().int().nonnegative();
const base64 = z
  .string()
  .min(4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const documentSchema = z
  .object({
    id,
    storyProjectId: id,
    storyChapterId: id,
    type: z.literal("script"),
    status: z.literal("active"),
    currentSequence: sequence,
    snapshotSequence: sequence,
    crdtStateBase64: base64.nullish(),
  })
  .refine(
    (v) =>
      v.snapshotSequence <= v.currentSequence && (v.snapshotSequence === 0 || !!v.crdtStateBase64),
    "Script snapshot cannot reconstruct its sequence."
  );
const operationSchema = z
  .object({
    id,
    documentId: id,
    sequence: sequence.positive(),
    operationType: z.enum(["yjs_update", "patch", "snapshot", "comment", "system"]),
    clientMutationId: z.string().nullish(),
    yjsUpdateBase64: base64.nullish(),
  })
  .refine(
    (v) => v.operationType !== "yjs_update" || !!v.yjsUpdateBase64,
    "Script update is missing CRDT data."
  );
export type ScriptOperation = z.infer<typeof operationSchema>;
export type ScriptScope = TimelineScope & { documentId: string };
const commandSchema = z.object({ clientKey: id, yjsUpdateBase64: base64 }).strict();
export type ScriptUpdateCommand = z.infer<typeof commandSchema>;
function current(scope: TimelineScope, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (scope.generation !== getAuthGeneration()) throw Error("Script session expired.");
  id.parse(scope.projectId);
  id.parse(scope.chapterId);
}
function document(scope: TimelineScope, raw: unknown, documentId?: string) {
  current(scope);
  const value = z.object({ document: documentSchema }).parse(raw).document;
  if (
    value.storyProjectId !== scope.projectId ||
    value.storyChapterId !== scope.chapterId ||
    (documentId && value.id !== documentId)
  )
    throw Error("Script document scope mismatch.");
  return value;
}
/** The REST log can compact during pagination. Never treat a missing sequence as an empty edit. */
async function replay(
  scope: TimelineScope,
  doc: z.infer<typeof documentSchema>,
  signal: AbortSignal
) {
  const operations: ScriptOperation[] = [];
  let cursor = doc.snapshotSequence;
  while (cursor < doc.currentSequence) {
    current(scope, signal);
    const raw = await api.get(`/documents/${doc.id}/operations`, {
      service: "aurora",
      signal,
      retry: false,
      params: { afterSequence: cursor, limit: 500 },
    });
    current(scope, signal);
    const page = z.object({ operations: z.array(operationSchema).max(500) }).parse(raw).operations;
    if (!page.length) throw Error("Script history changed during loading. Reload the document.");
    for (const op of page) {
      if (op.documentId !== doc.id || op.sequence !== cursor + 1)
        throw Error(
          "Script history is incomplete or belongs to another document. Reload the document."
        );
      if (op.operationType === "patch" || op.operationType === "snapshot")
        throw Error("Script history requires a fresh compacted CRDT snapshot.");
      operations.push(op);
      cursor = op.sequence;
      if (cursor === doc.currentSequence) break;
    }
  }
  return { document: doc, operations, sequence: cursor };
}
export async function openScriptCollaboration(scope: TimelineScope, signal: AbortSignal) {
  current(scope, signal);
  const raw = await api.post(
    `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/documents/script/ensure`,
    { service: "aurora", data: {}, signal, retry: false }
  );
  current(scope, signal);
  return replay(scope, document(scope, raw), signal);
}
export async function reloadScriptCollaboration(scope: ScriptScope, signal: AbortSignal) {
  current(scope, signal);
  id.parse(scope.documentId);
  const raw = await api.get(`/documents/${scope.documentId}`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(scope, signal);
  return replay(scope, document(scope, raw, scope.documentId), signal);
}
/** CRDT updates retain their exact mutation id until the server echoes the same update. */
export function scriptUpdatePending(
  scope: ScriptScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-script-update",
    userId,
    `${scope.projectId}:${scope.chapterId}:${scope.documentId}`
  )
) {
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  return {
    ...pending,
    submit: async (raw: ScriptUpdateCommand) => {
      current(scope);
      id.parse(scope.documentId);
      const command = commandSchema.parse(raw);
      pending.save(command);
      // Confirm the document's chapter before sending a write to the document-scoped endpoint.
      document(
        scope,
        await api.get(`/documents/${scope.documentId}`, { service: "aurora", retry: false }),
        scope.documentId
      );
      const result = await api.post(`/documents/${scope.documentId}/operations`, {
        service: "aurora",
        retry: false,
        data: {
          operationType: "yjs_update",
          clientMutationId: command.clientKey,
          idempotencyKey: `mobile-script:${command.clientKey}`,
          yjsUpdateBase64: command.yjsUpdateBase64,
        },
      });
      current(scope);
      const op = z.object({ operation: operationSchema }).parse(result).operation;
      if (
        op.documentId !== scope.documentId ||
        op.operationType !== "yjs_update" ||
        op.clientMutationId !== command.clientKey ||
        op.yjsUpdateBase64 !== command.yjsUpdateBase64
      )
        throw Error("Script update receipt mismatch. Retry the saved request.");
      pending.clear(command.clientKey);
      return op;
    },
  };
}
