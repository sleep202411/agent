import * as Y from "yjs";
import { removeCanvasNode } from "./node-remove";
import { canvasNodeEditSchema, type CanvasNodeEdit } from "./schema";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";

export { canvasNodeEditSchema, type CanvasNodeEdit } from "./schema";
const generationTypes = new Set(["prompt", "video", "audio"]);
const mediaTypes = new Set(["image", "videoAsset", "audioAsset"]);

/** Web patchNodeData semantics: mutate the existing per-field map in place.
 * The returned update is a delta, never a replacement JSON snapshot. */
export function editCanvasNode(state: string, raw: CanvasNodeEdit) {
  const edit = canvasNodeEditSchema.parse(raw);
  if (edit.kind === "remove") return removeCanvasNode(state, edit.nodeId);
  return withCanvasState(state, [], (doc) => {
    const node = doc.getMap("nodes").get(edit.nodeId);
    if (!(node instanceof Y.Map) || node.get("id") !== edit.nodeId)
      throw Error("Canvas node is unavailable. Reload the document.");
    const type = node.get("type"),
      data = node.get("data");
    if (typeof type !== "string" || !(data instanceof Y.Map))
      throw Error("Canvas node data is invalid.");
    const generation = generationTypes.has(type),
      media = mediaTypes.has(type);
    if (
      (!generation && !media) ||
      (edit.kind === "prompt" && (!generation || data.get("locked") === true))
    )
      throw Error("This canvas node does not support that edit.");
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      const field = edit.kind === "prompt" ? "prompt" : generation ? "name" : "label";
      const value = edit.kind === "prompt" ? edit.value : edit.value.trim() || undefined;
      if (data.get(field) !== value) data.set(field, value);
      // Web media rename also renames every matching inventory entry.
      const mediaAssetId = data.get("mediaAssetId");
      if (edit.kind === "rename" && media && typeof mediaAssetId === "string") {
        const assets = doc.getMap("assets");
        for (const [key, asset] of assets.entries()) {
          if (!asset || typeof asset !== "object" || Array.isArray(asset)) continue;
          const existing = asset as Record<string, unknown>;
          if (existing.mediaAssetId !== mediaAssetId && existing.id !== mediaAssetId) continue;
          if (existing.name === value) continue;
          const next = { ...existing };
          if (value) next.name = value;
          else delete next.name;
          assets.set(key, next);
        }
      }
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
