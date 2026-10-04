import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { encodedCanvasState } from "../../../../canvas-editor/protocol";
import type { CandidateScope } from "./story-candidates-api";
import { readStoryCanvasDocument } from "./story-canvas-document";

const id = z.string().uuid();
export const canvasUpdateSchema = z
  .object({ clientKey: id, yjsUpdateBase64: encodedCanvasState })
  .strict();
export type CanvasUpdateCommand = z.infer<typeof canvasUpdateSchema>;
export type CanvasWriteScope = CandidateScope & { documentId: string };
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

/** Persist exact CRDT bytes before sending; only an exact receipt clears them.
 * A retry uses the same idempotency key, including after app restart. */
export function canvasUpdatePending(
  scope: CanvasWriteScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-canvas-update",
    userId,
    `${scope.projectId}:${scope.documentId}`
  )
) {
  const pending = pendingRequest(canvasUpdateSchema, scope.generation, storage);
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    id.parse(scope.documentId);
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  return {
    read: pending.read,
    submit: async (raw: CanvasUpdateCommand, signal: AbortSignal) => {
      current(signal);
      const command = canvasUpdateSchema.parse(raw);
      pending.save(command);
      // A document URL alone is insufficient: confirm it still belongs to this Story.
      await readStoryCanvasDocument(scope, scope.documentId, signal);
      current(signal);
      const response = await api.post(`/documents/${scope.documentId}/operations`, {
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
      current(signal);
      const receipt = receiptSchema.parse(response).operation;
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
