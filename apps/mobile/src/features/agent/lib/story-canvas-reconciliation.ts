import { canvasPositionDraftStore } from "./story-canvas-position-draft";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import {
  canvasUpdatePending,
  canvasUpdateSchema,
  type CanvasUpdateCommand,
} from "../api/story-canvas-update";
import { canvasGroupDraftStore } from "./story-canvas-group-draft";
import { platformCanvasUpdatePending } from "../api/platform-canvas-document";
import { platformActorDraftStore } from "./platform-actor-draft";
import { canvasDraftStore, type CanvasEditScope } from "./story-canvas-draft";
import { canvasCreateDraftStore } from "./story-canvas-create-draft";
import { canvasMediaDraftStore } from "./story-canvas-media-draft";

/** An automatic operation owns its exact bytes separately from the shared
 * transport journal. Never replace a manual draft or recompute a lost write. */
export function canvasReconciliation(
  scope: CanvasEditScope,
  userId: string,
  dependencies = {
    storage: durableRecord(
      "kind" in scope ? "platform-canvas-reconciliation" : "story-canvas-reconciliation",
      userId,
      "kind" in scope
        ? `${scope.workspaceId}:${scope.projectId}:${scope.sectionId}:${scope.documentId}`
        : `${scope.projectId}:${scope.documentId}`
    ),
    client:
      "kind" in scope
        ? platformCanvasUpdatePending(scope, userId)
        : canvasUpdatePending(scope, userId),
    hasDraft: () =>
      !!(
        ("kind" in scope && platformActorDraftStore(scope, userId).read()) ||
        canvasDraftStore(scope, userId).read() ||
        canvasCreateDraftStore(scope, userId).read() ||
        canvasMediaDraftStore(scope, userId).read() ||
        canvasGroupDraftStore(scope, userId).read() ||
        canvasPositionDraftStore(scope, userId).read()
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
