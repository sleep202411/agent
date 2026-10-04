import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import {
  canvasUpdatePending,
  canvasUpdateSchema,
  type CanvasUpdateCommand,
  type CanvasWriteScope,
} from "../api/story-canvas-update";
import { canvasGroupDraftStore } from "./story-canvas-group-draft";
import { canvasDraftStore } from "./story-canvas-draft";
import { canvasCreateDraftStore } from "./story-canvas-create-draft";
import { canvasMediaDraftStore } from "./story-canvas-media-draft";

/** An automatic operation owns its exact bytes separately from the shared
 * transport journal. Never replace a manual draft or recompute a lost write. */
export function canvasReconciliation(
  scope: CanvasWriteScope,
  userId: string,
  dependencies = {
    storage: durableRecord(
      "story-canvas-reconciliation",
      userId,
      `${scope.projectId}:${scope.documentId}`
    ),
    client: canvasUpdatePending(scope, userId),
    hasDraft: () =>
      !!(
        canvasDraftStore(scope, userId).read() ||
        canvasCreateDraftStore(scope, userId).read() ||
        canvasMediaDraftStore(scope, userId).read() ||
        canvasGroupDraftStore(scope, userId).read()
      ),
  } as {
    storage: DurableRecord;
    client: Pick<ReturnType<typeof canvasUpdatePending>, "read" | "submit">;
    hasDraft(): boolean;
  }
) {
  const own = pendingRequest(canvasUpdateSchema, scope.generation, dependencies.storage);
  const current = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  const same = (a: CanvasUpdateCommand, b: CanvasUpdateCommand) =>
    a.clientKey === b.clientKey && a.yjsUpdateBase64 === b.yjsUpdateBase64;
  return {
    read: own.read,
    canPrepare: () => {
      current();
      return !own.read() && !dependencies.client.read() && !dependencies.hasDraft();
    },
    prepare: (raw: CanvasUpdateCommand) => {
      current();
      const command = canvasUpdateSchema.parse(raw);
      const previous = own.read();
      if (previous) {
        if (!same(previous, command)) throw Error("A canvas synchronization is already pending.");
        return;
      }
      if (dependencies.client.read() || dependencies.hasDraft())
        throw Error("Finish the saved canvas action before synchronizing media.");
      own.save(command);
    },
    resume: async (signal: AbortSignal) => {
      current(signal);
      const command = own.read();
      if (!command) return false;
      const other = dependencies.client.read();
      if (other && !same(other, command))
        throw Error("Finish the saved canvas action before synchronizing media.");
      await dependencies.client.submit(command, signal);
      current(signal);
      own.clear(command.clientKey);
      return true;
    },
  };
}
