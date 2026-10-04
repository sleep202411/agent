import * as Y from "yjs";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";
import { canvasPositionEditSchema, type CanvasPositionEdit } from "./position-schema";

/** Web updateNodePosition semantics: commit final coordinates, leaving node
 * data and other CRDT maps intact. Validate the full selection before writing. */
export function editCanvasPositions(state: string, raw: CanvasPositionEdit) {
  const command = canvasPositionEditSchema.parse(raw);
  return withCanvasState(state, [], (doc) => {
    const nodes = doc.getMap("nodes");
    const moves = command.positions.map((move) => {
      const node = nodes.get(move.nodeId);
      if (!(node instanceof Y.Map) || node.get("id") !== move.nodeId)
        throw Error("A moved canvas node is unavailable. Reload the document.");
      return { node, ...move };
    });
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      for (const { node, x, y } of moves) {
        let position = node.get("position");
        // Match Web's repair of missing/legacy non-map positions.
        if (!(position instanceof Y.Map)) {
          position = new Y.Map<unknown>();
          node.set("position", position);
        }
        const target = position as Y.Map<unknown>;
        if (target.get("x") !== x) target.set("x", x);
        if (target.get("y") !== y) target.set("y", y);
      }
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
