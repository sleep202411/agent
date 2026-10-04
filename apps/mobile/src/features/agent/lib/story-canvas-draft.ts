import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { canvasNodeEditSchema, type CanvasNodeEdit } from "../../../../canvas-editor/schema";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
import type { CanvasWriteScope } from "../api/story-canvas-update";
import { canvasUpdateSchema } from "../../../../canvas-editor/protocol";

const draftSchema = z
  .object({
    edit: canvasNodeEditSchema,
    nodeType: z.string(),
    baseValue: z.string(),
    command: canvasUpdateSchema.optional(),
  })
  .strict();
export type CanvasDraft = z.infer<typeof draftSchema>;
export function canvasEditBaseline(
  snapshot: CanvasSnapshot,
  edit: Pick<CanvasNodeEdit, "nodeId" | "kind">
) {
  const node = z
    .object({ id: z.string(), type: z.string(), data: z.record(z.unknown()) })
    .parse(snapshot.nodes[edit.nodeId]);
  if (node.id !== edit.nodeId) throw Error("Canvas node identity mismatch.");
  const generation = ["prompt", "video", "audio"].includes(node.type);
  if (
    (!generation && !["image", "videoAsset", "audioAsset"].includes(node.type)) ||
    (edit.kind === "prompt" && (!generation || node.data.locked === true))
  )
    throw Error("This canvas node does not support that edit.");
  const field = edit.kind === "prompt" ? "prompt" : generation ? "name" : "label";
  return { nodeType: node.type, baseValue: z.string().parse(node.data[field] ?? "") };
}
/** One saved edit per canvas; reopening any edit resumes it instead of replacing it. */
export function canvasDraftStore(
  scope: CanvasWriteScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-canvas-draft",
    userId,
    `${scope.projectId}:${scope.documentId}`
  )
) {
  const current = () => {
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  const read = () => {
    current();
    const raw = storage.read();
    return raw === null
      ? null
      : z.object({ version: z.literal(1), draft: draftSchema.nullable() }).parse(JSON.parse(raw))
          .draft;
  };
  const write = (draft: CanvasDraft | null) => {
    current();
    storage.write(
      JSON.stringify({ version: 1, draft: draft === null ? null : draftSchema.parse(draft) })
    );
  };
  return { read, write };
}
