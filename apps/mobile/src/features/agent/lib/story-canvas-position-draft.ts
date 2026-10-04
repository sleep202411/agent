import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import {
  canvasPositionEditSchema,
  type CanvasPositionEdit,
} from "../../../../canvas-editor/position-schema";
import { canvasUpdateSchema, type CanvasSnapshot } from "../../../../canvas-editor/protocol";
import {
  canvasUpdatePending,
  type CanvasWriteScope,
  type CanvasUpdateCommand,
} from "../api/story-canvas-update";

export const canvasPositionDraftSchema = z
  .object({
    edit: canvasPositionEditSchema,
    baseline: z.string(),
    command: canvasUpdateSchema.optional(),
  })
  .strict();
export type CanvasPositionDraft = z.infer<typeof canvasPositionDraftSchema>;
/** Compare the coordinates Web actually renders; text/media/group colors can
 * change independently. A missing node must never be recreated by a stale drag. */
export function canvasPositionBaseline(snapshot: CanvasSnapshot, raw: CanvasPositionEdit) {
  const edit = canvasPositionEditSchema.parse(raw);
  return JSON.stringify(
    edit.positions.map(({ nodeId }) => {
      const node = z
        .object({ id: z.literal(nodeId), position: z.unknown().optional() })
        .parse(snapshot.nodes[nodeId]);
      const position =
        node.position && typeof node.position === "object"
          ? (node.position as Record<string, unknown>)
          : {};
      const coordinate = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? value : 0;
      return { nodeId, x: coordinate(position.x), y: coordinate(position.y) };
    })
  );
}
export function canvasPositionDraftStore(
  scope: CanvasWriteScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-canvas-position-draft",
    userId,
    `${scope.projectId}:${scope.documentId}`
  )
) {
  const current = () => {
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  return {
    read: (): CanvasPositionDraft | null => {
      current();
      const raw = storage.read();
      return raw === null
        ? null
        : z
            .object({ version: z.literal(1), draft: canvasPositionDraftSchema.nullable() })
            .strict()
            .parse(JSON.parse(raw)).draft;
    },
    write: (draft: CanvasPositionDraft | null) => {
      current();
      storage.write(
        JSON.stringify({
          version: 1,
          draft: draft === null ? null : canvasPositionDraftSchema.parse(draft),
        })
      );
    },
  };
}
/** Own exact bytes independently of the shared transport journal: a lost
 * response must replay the same movement, never encode a second drag. */
export function canvasPositionRecovery(
  scope: CanvasWriteScope,
  userId: string,
  dependencies = {
    store: canvasPositionDraftStore(scope, userId),
    client: canvasUpdatePending(scope, userId),
  }
) {
  const { store, client } = dependencies;
  const same = (a: CanvasUpdateCommand, b: CanvasUpdateCommand) =>
    a.clientKey === b.clientKey && a.yjsUpdateBase64 === b.yjsUpdateBase64;
  const available = (command?: CanvasUpdateCommand) => {
    const other = client.read();
    if (other && (!command || !same(other, command)))
      throw Error("Finish the saved canvas action before moving nodes.");
  };
  const requireDraft = () => {
    const draft = store.read();
    if (!draft) throw Error("No canvas movement is saved.");
    return draft;
  };
  return {
    read: store.read,
    stage: (snapshot: CanvasSnapshot, edit: CanvasPositionEdit) => {
      if (store.read()) throw Error("Finish or discard the saved movement first.");
      available();
      store.write({ edit, baseline: canvasPositionBaseline(snapshot, edit) });
    },
    validate: (snapshot: CanvasSnapshot) => {
      const draft = requireDraft();
      available(draft.command);
      if (!draft.command && canvasPositionBaseline(snapshot, draft.edit) !== draft.baseline)
        throw Error("Canvas positions changed. Discard the saved movement and try again.");
      return draft;
    },
    prepare: (command: CanvasUpdateCommand) => {
      const draft = requireDraft();
      const parsed = canvasUpdateSchema.parse(command);
      available(parsed);
      if (draft.command && !same(draft.command, parsed))
        throw Error("A canvas movement is already pending.");
      store.write({ ...draft, command: parsed });
    },
    discard: () => {
      if (requireDraft().command) throw Error("Retry the pending movement before discarding.");
      available();
      store.write(null);
    },
    resume: async (signal: AbortSignal) => {
      signal.throwIfAborted();
      const draft = requireDraft();
      if (!draft.command) throw Error("Canvas movement has not been encoded.");
      available(draft.command);
      await client.submit(draft.command, signal);
      signal.throwIfAborted();
      // Store rechecks account retirement. Do not erase a changed recovery record.
      const latest = requireDraft();
      if (!latest.command || !same(latest.command, draft.command))
        throw Error("Saved canvas movement changed.");
      store.write(null);
    },
  };
}
