import { z } from "zod";
import {
  canvasUploadedAssetSchema,
  canvasUploadCheckpointSchema,
} from "../../../../canvas-editor/upload-schema";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { canvasUpdateSchema, type CanvasSnapshot } from "../../../../canvas-editor/protocol";
import type { CanvasEditScope } from "./story-canvas-draft";
import { canvasUploadScopeMatches } from "./canvas-upload-scope";

export const canvasCreateDraftSchema = z
  .object({
    nodeId: z.string().uuid(),
    type: z.enum(["prompt", "video", "audio", "note", "shot", "libraryAsset", "uploadedAsset"]),
    name: z.string(),
    text: z.string(),
    command: canvasUpdateSchema.optional(),
    assetId: z.string().min(1).optional(),
    upload: canvasUploadCheckpointSchema.optional(),
    uploadedAsset: canvasUploadedAssetSchema.optional(),
  })
  .strict()
  .refine(
    (draft) => (!draft.upload && !draft.uploadedAsset) || draft.type === "uploadedAsset",
    "Only a media import can contain upload recovery."
  )
  .refine(
    (draft) => (draft.type === "libraryAsset") === !!draft.assetId,
    "Library creation requires its original asset identity."
  );
export type CanvasCreateDraft = z.infer<typeof canvasCreateDraftSchema>;
export function canvasCreateDraftStore(
  scope: CanvasEditScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "kind" in scope ? "platform-canvas-create-draft" : "story-canvas-create-draft",
    userId,
    "kind" in scope
      ? `${scope.workspaceId}:${scope.projectId}:${scope.sectionId}:${scope.documentId}`
      : `${scope.projectId}:${scope.documentId}`
  )
) {
  const scopedDraft = canvasCreateDraftSchema.refine(
    (draft) => !draft.upload || canvasUploadScopeMatches(scope, draft.upload),
    "Canvas upload project mismatch."
  );
  const current = () => {
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  return {
    read: () => {
      current();
      const raw = storage.read();
      return raw === null
        ? null
        : z.object({ version: z.literal(1), draft: scopedDraft.nullable() }).parse(JSON.parse(raw))
            .draft;
    },
    write: (draft: CanvasCreateDraft | null) => {
      current();
      storage.write(
        JSON.stringify({
          version: 1,
          draft: draft === null ? null : scopedDraft.parse(draft),
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
