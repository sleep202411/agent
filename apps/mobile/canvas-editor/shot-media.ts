import * as Y from "yjs";
import { z } from "zod";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";

import { canvasShotMediaSchema, type CanvasShotMedia } from "./shot-media-schema";
export { canvasShotMediaSchema, type CanvasShotMedia } from "./shot-media-schema";
const referencesSchema = z.record(
  z.array(
    z
      .object({
        edgeId: z.string().optional(),
        sourceNodeId: z.string().optional(),
      })
      .passthrough()
  )
);
const kinds: Record<string, "image" | "video" | "audio"> = {
  image: "image",
  panorama: "image",
  prompt: "image",
  video: "video",
  videoAsset: "video",
  audio: "audio",
  audioAsset: "audio",
};
function outputKind(type: unknown) {
  return typeof type === "string" && Object.hasOwn(kinds, type) ? kinds[type] : undefined;
}
const generationTypes = new Set(["prompt", "video", "audio"]);
function nodeData(nodes: Y.Map<unknown>, id: string) {
  const node = nodes.get(id);
  if (!(node instanceof Y.Map) || node.get("id") !== id || !(node.get("data") instanceof Y.Map))
    throw Error("Canvas node is unavailable. Reload the document.");
  return { type: node.get("type"), data: node.get("data") as Y.Map<unknown> };
}

/** Shot-only counterpart of Web canvas-wiring and useStoryboard picture actions.
 * Validates before mutation; never deletes source nodes or reusable assets.
 * A pending source creates a wire reservation without persisting blob URLs. */
class ShotConnectionRejected extends Error {}
function applyShotMedia(doc: Y.Doc, command: CanvasShotMedia) {
  const nodes = doc.getMap("nodes"),
    edges = doc.getMap("edges");
  const target = nodeData(nodes, command.nodeId);
  if (target.type !== "shot") throw Error("This canvas node is not a storyboard shot.");
  const refs = referencesSchema.parse(target.data.get("references") ?? {});
  let nextRefs: typeof refs | undefined;
  let newEdge: Record<string, string> | undefined;
  let preferred: string | undefined;
  let changePreferred = false;
  if (command.action === "prefer") {
    if (command.edgeId && !(refs.frame ?? []).some((ref) => ref.edgeId === command.edgeId))
      throw Error("The selected frame is no longer attached to this shot.");
    preferred = command.edgeId;
    changePreferred = target.data.get("preferredFrameEdgeId") !== preferred;
  } else if (command.action === "detach") {
    const edge = edges.get(command.edgeId);
    if (
      edge != null &&
      (!(edge instanceof Y.Map) ||
        edge.get("id") !== command.edgeId ||
        edge.get("target") !== command.nodeId)
    )
      throw Error("This connection does not belong to the selected shot.");
    nextRefs = Object.fromEntries(
      Object.entries(refs).map(([field, list]) => [
        field,
        list.filter((ref) => ref.edgeId !== command.edgeId),
      ])
    );
    if (target.data.get("preferredFrameEdgeId") === command.edgeId) changePreferred = true;
  } else {
    const existingEdge = command.action === "refresh" ? edges.get(command.edgeId) : undefined;
    if (
      command.action === "refresh" &&
      (!(existingEdge instanceof Y.Map) ||
        existingEdge.get("id") !== command.edgeId ||
        existingEdge.get("target") !== command.nodeId ||
        typeof existingEdge.get("source") !== "string")
    )
      throw Error("The shot connection changed. Reload the document.");
    const sourceId =
      command.action === "attach"
        ? command.sourceId
        : ((existingEdge as Y.Map<unknown>).get("source") as string);
    if (sourceId === command.nodeId)
      throw new ShotConnectionRejected("A node cannot connect to itself.");
    if (command.action === "attach" && edges.has(command.edgeId))
      throw Error("Canvas connection ID already exists.");
    const source = nodeData(nodes, sourceId);
    const allRefs = Object.values(refs).flat();
    const boundField =
      command.action === "refresh"
        ? Object.keys(refs).find((key) => refs[key].some((ref) => ref.edgeId === command.edgeId))
        : undefined;
    const generated = generationTypes.has(String(source.type));
    const data = source.data.toJSON();
    const output = generated ? data.generation?.outputs?.[0] : data;
    const url = generated ? output?.url : output?.src;
    if (url != null && typeof url !== "string") throw Error("Canvas source URL is invalid.");
    // Web refreshes existing bindings without revalidating their original type
    // or capacity. Only the URL changes; asset/job metadata stays attached.
    if (boundField) {
      if (url && !url.startsWith("blob:")) {
        const next = {
          ...refs,
          [boundField]: refs[boundField].map((ref) =>
            ref.edgeId === command.edgeId ? { ...ref, url } : ref
          ),
        };
        if (JSON.stringify(next) !== JSON.stringify(refs)) target.data.set("references", next);
      }
      return;
    }
    const kind = outputKind(source.type);
    if (!kind || kind === "audio")
      throw new ShotConnectionRejected("A shot accepts image and video connections only.");
    const field = kind === "image" ? "frame" : "clip",
      limit = kind === "image" ? 24 : 1;
    if (
      !boundField &&
      allRefs.some((ref) => ref.sourceNodeId === sourceId && ref.edgeId !== command.edgeId)
    )
      throw new ShotConnectionRejected("This source is already connected to the shot.");
    const bound = new Set(allRefs.flatMap((ref) => (ref.edgeId ? [ref.edgeId] : [])));
    let reserved = 0;
    for (const [id, edge] of edges) {
      if (
        !(edge instanceof Y.Map) ||
        edge.get("id") !== id ||
        typeof edge.get("source") !== "string" ||
        typeof edge.get("target") !== "string"
      )
        throw Error("Canvas connection data is invalid.");
      if (edge.get("target") !== command.nodeId) continue;
      if (!boundField && id !== command.edgeId && edge.get("source") === sourceId)
        throw new ShotConnectionRejected("This source is already connected to the shot.");
      const pendingSource = nodes.get(edge.get("source") as string);
      if (
        id !== command.edgeId &&
        !bound.has(id) &&
        pendingSource instanceof Y.Map &&
        outputKind(pendingSource.get("type")) === kind
      )
        reserved++;
    }
    if (
      !boundField &&
      (refs[field]?.filter((ref) => ref.edgeId !== command.edgeId).length ?? 0) + reserved >= limit
    )
      throw new ShotConnectionRejected(`This shot accepts at most ${limit} ${kind} references.`);
    if (command.action === "attach")
      newEdge = {
        id: command.edgeId,
        source: sourceId,
        target: command.nodeId,
        sourceHandle: "output",
        targetHandle: "input",
      };
    if (url && !url.startsWith("blob:")) {
      const reference: Record<string, unknown> = {
        id: command.edgeId,
        edgeId: command.edgeId,
        sourceNodeId: sourceId,
        url,
        kind,
      };
      const assetId = generated ? output.assetId : output.mediaAssetId;
      if (typeof assetId === "string" && assetId) reference.assetId = assetId;
      if (generated && typeof data.generation?.jobId === "string" && data.generation.jobId.trim())
        reference.sourceJobId = data.generation.jobId;
      const name = generated ? data.prompt : (data.label ?? data.name);
      if (typeof name === "string" && name.trim()) reference.name = name.trim();
      for (const key of ["bytes", "width", "height", "durationSeconds"])
        if (typeof output[key] === "number" && Number.isFinite(output[key]) && output[key] > 0)
          reference[key] = output[key];
      nextRefs = { ...refs, [field]: [...(refs[field] ?? []), reference] };
    }
  }
  doc.transact(() => {
    if (newEdge) edges.set(newEdge.id, new Y.Map(Object.entries(newEdge)));
    if (command.action === "detach") edges.delete(command.edgeId);
    if (nextRefs && JSON.stringify(nextRefs) !== JSON.stringify(refs))
      target.data.set("references", nextRefs);
    if (changePreferred) target.data.set("preferredFrameEdgeId", preferred);
  });
}
function captureMutation(doc: Y.Doc, mutate: () => void) {
  let update: string | null = null;
  doc.on("update", (bytes: Uint8Array) => {
    update = encodeCanvasBytes(bytes);
  });
  doc.transact(mutate);
  return { ...captureCanvasState(doc), yjsUpdateBase64: update };
}
export function editCanvasShotMedia(state: string, raw: CanvasShotMedia) {
  const command = canvasShotMediaSchema.parse(raw);
  return withCanvasState(state, [], (doc) =>
    captureMutation(doc, () => applyShotMedia(doc, command))
  );
}

/** Web's shot reference reconciliation pass, emitted as one retryable delta.
 * Unbound invalid connections are removed as on Web; malformed documents abort
 * the isolated pass, returning no partial update. Other node types are untouched. */
export function reconcileCanvasShotMedia(state: string) {
  return withCanvasState(state, [], (doc) =>
    captureMutation(doc, () => {
      const nodes = doc.getMap("nodes"),
        edges = doc.getMap("edges");
      for (const [id, edge] of [...edges.entries()]) {
        if (
          !(edge instanceof Y.Map) ||
          edge.get("id") !== id ||
          typeof edge.get("source") !== "string" ||
          typeof edge.get("target") !== "string"
        )
          throw Error("Canvas connection data is invalid.");
        const targetId = edge.get("target") as string,
          target = nodes.get(targetId);
        if (!(target instanceof Y.Map) || target.get("type") !== "shot") continue;
        const data = nodeData(nodes, targetId).data;
        const refs = referencesSchema.parse(data.get("references") ?? {});
        const bound = Object.values(refs)
          .flat()
          .some((ref) => ref.edgeId === id);
        if (!nodes.has(edge.get("source") as string)) {
          if (!bound) edges.delete(id);
          continue;
        }
        try {
          applyShotMedia(doc, { action: "refresh", nodeId: targetId, edgeId: id });
        } catch (cause) {
          if (!bound && cause instanceof ShotConnectionRejected) edges.delete(id);
          else throw cause;
        }
      }
    })
  );
}
