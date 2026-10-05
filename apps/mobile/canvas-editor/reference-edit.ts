import * as Y from "yjs";
import { canvasReferenceEditSchema, type CanvasReferenceEdit } from "./reference-schema";
import {
  canvasReferencesSchema,
  canvasSourceKind,
  routeCanvasReference,
} from "./reference-routing";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";

function readNode(doc: Y.Doc, id: string) {
  const node = doc.getMap("nodes").get(id);
  if (!(node instanceof Y.Map) || node.get("id") !== id || !(node.get("data") instanceof Y.Map))
    throw Error("Canvas node is unavailable. Reload the document.");
  return { type: node.get("type"), data: node.get("data") as Y.Map<unknown> };
}
/** Validate against fresh document state before emitting a single atomic delta.
 * Detaching remains possible when a source/model is removed. Assets stay intact. */
export function editCanvasReferences(state: string, raw: CanvasReferenceEdit) {
  const edit = canvasReferenceEditSchema.parse(raw);
  return withCanvasState(state, [], (doc) => {
    const target = readNode(doc, edit.nodeId);
    if (!["prompt", "video", "audio"].includes(String(target.type)))
      throw Error("This node does not accept generation references.");
    const edges = doc.getMap("edges");
    const edge = "edgeId" in edit ? edges.get(edit.edgeId) : undefined;
    if (edit.action === "attach" && edge != null)
      throw Error("Canvas connection ID already exists.");
    if (
      edit.action !== "attach" &&
      edit.action !== "removeReference" &&
      edge != null &&
      (!(edge instanceof Y.Map) ||
        edge.get("id") !== edit.edgeId ||
        edge.get("target") !== edit.nodeId)
    )
      throw Error("This connection does not belong to the selected node.");
    const refs = canvasReferencesSchema.parse(target.data.get("references") ?? {});
    let next = refs;
    let newEdge: Record<string, string> | undefined;
    if (edit.action === "removeReference") {
      const matches = (refs[edit.field] ?? []).filter((row) => row.id === edit.referenceId);
      if (matches.length > 1) throw Error("Reference identity is ambiguous. Reload the document.");
      if (matches[0]?.edgeId)
        throw Error("This reference now has a canvas connection. Reload the document.");
      if (matches.length)
        next = {
          ...refs,
          [edit.field]: refs[edit.field]!.filter((row) => row.id !== edit.referenceId),
        };
    } else if (edit.action === "detach") {
      next = Object.fromEntries(
        Object.entries(refs).map(([field, rows]) => [
          field,
          rows.filter((ref) => ref.edgeId !== edit.edgeId),
        ])
      );
    } else {
      if (
        target.data.get("modelId") !== edit.target.modelId ||
        target.data.get("mode") !== edit.target.mode
      )
        throw Error("The target model or mode changed. Reload the document.");
      const sourceId =
        edit.action === "attach"
          ? edit.sourceId
          : edge instanceof Y.Map
            ? edge.get("source")
            : undefined;
      if (typeof sourceId !== "string")
        throw Error("The reference connection changed. Reload the document.");
      if (sourceId === edit.nodeId) throw Error("A node cannot connect to itself.");
      const source = readNode(doc, sourceId);
      const kind = canvasSourceKind(doc, sourceId);
      if (!kind) throw Error("This source has no image, video or audio output to connect.");
      const route = routeCanvasReference(
        doc,
        sourceId,
        edit.nodeId,
        edit.edgeId,
        kind,
        edit.target,
        refs
      );
      if ("error" in route) throw Error(route.error);
      const generated = ["prompt", "video", "audio"].includes(String(source.type));
      const data = source.data.toJSON();
      const output = generated ? data.generation?.outputs?.[0] : data;
      const url = generated ? output?.url : output?.src;
      if (url != null && typeof url !== "string") throw Error("Canvas source URL is invalid.");
      if (edit.action === "attach")
        newEdge = {
          id: edit.edgeId,
          source: sourceId,
          target: edit.nodeId,
          sourceHandle: "output",
          targetHandle: "input",
        };
      // A pending source reserves capacity. Never replace a bound durable reference
      // with a local blob or remove it while a new generation is in progress.
      if (url && !url.startsWith("blob:")) {
        const ref: Record<string, unknown> = {
          id: edit.edgeId,
          edgeId: edit.edgeId,
          sourceNodeId: sourceId,
          url,
          kind,
        };
        const assetId = generated ? output.assetId : output.mediaAssetId;
        if (typeof assetId === "string" && assetId) ref.assetId = assetId;
        if (generated && typeof data.generation?.jobId === "string" && data.generation.jobId.trim())
          ref.sourceJobId = data.generation.jobId;
        const name = generated ? data.prompt : (data.label ?? data.name);
        if (typeof name === "string" && name.trim()) ref.name = name.trim();
        for (const key of ["bytes", "width", "height", "durationSeconds"])
          if (typeof output[key] === "number" && Number.isFinite(output[key]) && output[key] > 0)
            ref[key] = output[key];
        next = { ...route.filtered, [route.field]: [...(route.filtered[route.field] ?? []), ref] };
      }
    }
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      if (newEdge) edges.set(newEdge.id, new Y.Map(Object.entries(newEdge)));
      if (edit.action === "detach") edges.delete(edit.edgeId);
      if (JSON.stringify(next) !== JSON.stringify(target.data.get("references") ?? {}))
        target.data.set("references", next);
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
