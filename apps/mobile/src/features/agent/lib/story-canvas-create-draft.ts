import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { canvasUpdateSchema, type CanvasSnapshot } from "../../../../canvas-editor/protocol";
import type { CanvasWriteScope } from "../api/story-canvas-update";

export const canvasCreateDraftSchema = z
  .object({
    nodeId: z.string().uuid(),
    type: z.enum(["prompt", "video", "audio", "note", "shot", "libraryAsset"]),
    name: z.string(),
    text: z.string(),
    command: canvasUpdateSchema.optional(),
    assetId: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (draft) => (draft.type === "libraryAsset") === !!draft.assetId,
    "Library creation requires its original asset identity."
  );
export type CanvasCreateDraft = z.infer<typeof canvasCreateDraftSchema>;
export function canvasCreateDraftStore(
  scope: CanvasWriteScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-canvas-create-draft",
    userId,
    `${scope.projectId}:${scope.documentId}`
  )
) {
  const current = () => {
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  return {
    read: () => {
      current();
      const raw = storage.read();
      return raw === null
        ? null
        : z
            .object({ version: z.literal(1), draft: canvasCreateDraftSchema.nullable() })
            .parse(JSON.parse(raw)).draft;
    },
    write: (draft: CanvasCreateDraft | null) => {
      current();
      storage.write(
        JSON.stringify({
          version: 1,
          draft: draft === null ? null : canvasCreateDraftSchema.parse(draft),
        })
      );
    },
  };
}
/** Put a newly added card to the right of the existing layout. Existing
 * positions stay unchanged; coordinates belong to the shared Web canvas. */
export function canvasAppendPosition(snapshot: CanvasSnapshot) {
  let right: number | undefined;
  for (const value of Object.values(snapshot.nodes)) {
    const node = z
      .object({
        position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
        width: z.number().finite().nonnegative().optional(),
      })
      .passthrough()
      .parse(value);
    right = Math.max(
      right ?? -Infinity,
      (node.position?.x ?? 0) + Math.max(node.width ?? 480, 480)
    );
  }
  const x = right === undefined ? 0 : right + 80;
  if (!Number.isFinite(x)) throw Error("Canvas placement is invalid.");
  return { x, y: 0 };
}
