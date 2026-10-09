import * as Y from "yjs";
import { z } from "zod";
import type { CanvasReferenceTarget } from "./reference-schema";

export const canvasReferencesSchema = z.record(
  z.string(),
  z.array(
    z.object({ edgeId: z.string().optional(), sourceNodeId: z.string().optional() }).passthrough()
  )
);
export type CanvasReferences = z.infer<typeof canvasReferencesSchema>;
export function canvasSourceKind(doc: Y.Doc, source: unknown) {
  if (typeof source !== "string") return undefined;
  const node = doc.getMap("nodes").get(source);
  if (!(node instanceof Y.Map)) return undefined;
  switch (node.get("type")) {
    case "image":
    case "panorama":
    case "prompt":
      return "image";
    case "video":
    case "videoAsset":
      return "video";
    case "audio":
    case "audioAsset":
      return "audio";
    default:
      return undefined;
  }
}
/** Shared by explicit wiring and completed-output backfill, matching Web routing. */
export function routeCanvasReference(
  doc: Y.Doc,
  sourceId: string,
  targetId: string,
  edgeId: string,
  kind: "image" | "video" | "audio",
  slots: CanvasReferenceTarget,
  previous: CanvasReferences
): { field: string; filtered: CanvasReferences } | { error: string } {
  const otherEdges = [...doc.getMap("edges").entries()]
    .filter(
      ([key, candidate]) =>
        candidate instanceof Y.Map &&
        candidate.get("id") === key &&
        key !== edgeId &&
        candidate.get("target") === targetId
    )
    .map(([, candidate]) => candidate as Y.Map<unknown>);
  const rows = Object.values(previous).flat();
  if (
    rows.some((row) => row.sourceNodeId === sourceId && row.edgeId !== edgeId) ||
    otherEdges.some((candidate) => candidate.get("source") === sourceId)
  )
    return { error: "This source is already connected to the node." };
  const boundIds = new Set(rows.map((row) => row.edgeId));
  let reserved = otherEdges.filter(
    (candidate) =>
      !boundIds.has(candidate.get("id") as string) &&
      canvasSourceKind(doc, candidate.get("source")) === kind
  ).length;
  const filtered = Object.fromEntries(
    Object.entries(previous).map(([key, refs]) => [
      key,
      refs.filter((row) => row.edgeId !== edgeId),
    ])
  );
  const matching = slots.fields.filter((slot) => slot.kind === kind);
  if (!matching.length)
    return { error: `The current model mode does not accept ${kind} references.` };
  for (const slot of matching) {
    const available = Math.max(0, slot.maxItems - (filtered[slot.field]?.length ?? 0));
    if (reserved < available) return { field: slot.field, filtered };
    reserved -= available;
  }
  return {
    error: `The current mode accepts at most ${matching.reduce((total, slot) => total + slot.maxItems, 0)} ${kind} references.`,
  };
}
