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
    title: z.string().optional(),
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
  if (edit.kind === "remove") {
    const edges = Object.fromEntries(
      Object.entries(snapshot.edges).filter(([, value]) => {
        const edge = z.object({ source: z.string(), target: z.string() }).parse(value);
        return edge.source === edit.nodeId || edge.target === edit.nodeId;
      })
    );
    const targets = Object.fromEntries(
      Object.values(edges).map((value) => {
        const target = (value as { target: string }).target;
        const data = snapshot.nodes[target] as { data?: { references?: unknown } } | undefined;
        return [target, data?.data?.references ?? null];
      })
    );
    return {
      nodeType: node.type,
      baseValue: stableJson({
        node: snapshot.nodes[edit.nodeId],
        edges,
        targets,
        groups: snapshot.groups,
      }),
    };
  }
  if (edit.kind === "text") {
    if (node.type !== "note") throw Error("This canvas node does not support that edit.");
    return { nodeType: node.type, baseValue: z.string().parse(node.data.text ?? "") };
  }
  const generation = ["prompt", "video", "audio"].includes(node.type);
  if (
    (!generation && !["image", "videoAsset", "audioAsset"].includes(node.type)) ||
    (edit.kind === "prompt" && (!generation || node.data.locked === true))
  )
    throw Error("This canvas node does not support that edit.");
  const field = edit.kind === "prompt" ? "prompt" : generation ? "name" : "label";
  return { nodeType: node.type, baseValue: z.string().parse(node.data[field] ?? "") };
}
function stableJson(value: unknown): string {
  const order = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(order);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, order(item)])
      );
    return value;
  };
  return JSON.stringify(order(value));
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
