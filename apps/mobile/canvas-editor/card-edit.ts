import * as Y from "yjs";
import {
  CANVAS_CARD_CONFLICT,
  canvasCardStateSchema,
  type CanvasCardState,
} from "./card-state-schema";
import { canonical } from "./json-value";
export { canonical } from "./json-value";
/** Validate all authoring fields and wire ownership before mutating any CRDT data. */
export function canvasAuthoringPatches(
  doc: Y.Doc,
  data: Y.Map<unknown>,
  nodeId: string,
  cardEdit: { before: CanvasCardState; after: CanvasCardState }
) {
  const patches: [string, unknown][] = [];
  const removedEdges: string[] = [];
  const edges = doc.getMap("edges");
  const current = canvasCardStateSchema.parse(
    Object.fromEntries(Object.keys(cardEdit.before).map((name) => [name, data.get(name)]))
  );
  for (const key of Object.keys(cardEdit.after) as (keyof typeof current)[]) {
    if (
      canonical(current[key]) !== canonical(cardEdit.before[key]) &&
      canonical(current[key]) !== canonical(cardEdit.after[key])
    )
      throw Error(
        `${CANVAS_CARD_CONFLICT}The canvas ${key} changed while composing. Review before saving.`
      );
    if (canonical(current[key]) !== canonical(cardEdit.after[key]))
      patches.push([key, cardEdit.after[key]]);
  }
  const retained = new Set(
    Object.values(cardEdit.after.references)
      .flat()
      .map((row) => row.edgeId)
  );
  for (const row of Object.values(cardEdit.before.references).flat()) {
    if (typeof row.edgeId !== "string" || retained.has(row.edgeId)) continue;
    const edge = edges.get(row.edgeId);
    if (!edge) continue;
    if (
      !(edge instanceof Y.Map) ||
      edge.get("id") !== row.edgeId ||
      edge.get("target") !== nodeId ||
      (row.sourceNodeId && edge.get("source") !== row.sourceNodeId)
    )
      throw Error("A reference connection changed while composing. Reload before saving.");
    removedEdges.push(row.edgeId);
  }
  return { patches, removedEdges };
}
