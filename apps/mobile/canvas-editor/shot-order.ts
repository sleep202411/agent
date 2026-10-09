import * as Y from "yjs";
import { compareByOrder, orderBetween } from "@repo/shared";
import { z } from "zod";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";

export const canvasShotMoveSchema = z
  .object({ nodeId: z.string().min(1), index: z.number().int().nonnegative() })
  .strict();
export type CanvasShotMove = z.infer<typeof canvasShotMoveSchema>;

/** Web moveShotToIndex semantics: destination is a zero-based index in the
 * current list. Only the moved shot's order field is written. The transport
 * must persist/retry the resulting bytes, never recompute a submitted move. */
export function moveCanvasShot(state: string, raw: CanvasShotMove) {
  const command = canvasShotMoveSchema.parse(raw);
  return withCanvasState(state, [], (doc) => {
    const nodes = doc.getMap("nodes");
    const shots: { id: string; order?: string | null; data: Y.Map<unknown> }[] = [];
    for (const [id, node] of nodes) {
      if (!(node instanceof Y.Map) || node.get("type") !== "shot") continue;
      const data = node.get("data");
      if (node.get("id") !== id || !(data instanceof Y.Map))
        throw Error("Canvas shot data is invalid. Reload the document.");
      const order = data.get("order");
      if (order != null && typeof order !== "string") throw Error("Canvas shot order is invalid.");
      shots.push({ id, order, data });
    }
    shots.sort(compareByOrder);
    const selected = shots.find((shot) => shot.id === command.nodeId);
    if (!selected) throw Error("Canvas shot is unavailable. Reload the document.");
    const remaining = shots.filter((shot) => shot.id !== command.nodeId);
    const index = Math.min(command.index, remaining.length);
    const order = orderBetween(remaining[index - 1]?.order, remaining[index]?.order);
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    if (order !== selected.order) selected.data.set("order", order);
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
