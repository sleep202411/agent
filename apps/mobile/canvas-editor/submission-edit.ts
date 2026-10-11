import { canonical, canvasAuthoringPatches } from "./card-edit";
import * as Y from "yjs";
import {
  canvasSubmissionRecordSchema,
  type CanvasSubmissionRecord,
  type CanvasAuthoring,
} from "./submission-schema";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";
const kinds: Record<string, string> = { prompt: "image", video: "video", audio: "audio" };
/** Persist the same recovery record as Web before the host sends a paid job. */
export function recordCanvasSubmission(
  state: string,
  documentId: string,
  raw: CanvasSubmissionRecord
) {
  const command = canvasSubmissionRecordSchema.parse(raw);
  if ("authoring" in command) return recordCanvasAuthoring(state, documentId, command);
  const input = "submission" in command ? command.submission : null;
  const retry = "retry" in command ? command.retry : null;
  const receipt = "receipt" in command ? command.receipt : null;
  const context = input?.context ?? retry ?? receipt!;
  const key = input?.idempotencyKey ?? receipt?.submissionKey ?? `retry:${retry!.jobId}`;
  if (context.documentId !== documentId) throw Error("Submission belongs to another document.");
  return withCanvasState(state, [], (doc) => {
    const node = doc.getMap("nodes").get(context.documentBlockId);
    if (!(node instanceof Y.Map) || node.get("id") !== context.documentBlockId)
      throw Error("Generation card is unavailable. Reload the document.");
    const data = node.get("data");
    if (
      !(data instanceof Y.Map) ||
      kinds[String(node.get("type"))] !== command.type ||
      data.get("locked") === true
    )
      throw Error("This card cannot start this generation.");
    const previous = data.get("generation") as Record<string, unknown> | null | undefined;
    if (previous != null && (typeof previous !== "object" || Array.isArray(previous)))
      throw Error("Generation card state is invalid.");
    if (receipt) {
      if (
        previous?.submissionKey !== key ||
        (previous.submissionOwnerId && previous.submissionOwnerId !== command.ownerId)
      )
        throw Error("The receipt no longer belongs to this card request.");
      if (previous.jobId) {
        if (previous.jobId !== receipt.jobId)
          throw Error("Generation was replaced by another run.");
        return { ...captureCanvasState(doc), yjsUpdateBase64: null };
      }
      let update: string | null = null;
      doc.on("update", (bytes: Uint8Array) => {
        update = encodeCanvasBytes(bytes);
      });
      doc.transact(() => data.set("generation", { ...previous, jobId: receipt.jobId }));
      return { ...captureCanvasState(doc), yjsUpdateBase64: update };
    }
    if (previous?.submissionKey === key) {
      if (input && previous.submission && canonical(previous.submission) !== canonical(input))
        throw Error("The saved generation request changed. Keep the original request.");
      if (previous.submissionOwnerId && previous.submissionOwnerId !== command.ownerId)
        throw Error("This submission belongs to another account.");
      return { ...captureCanvasState(doc), yjsUpdateBase64: null };
    }
    if (
      retry &&
      (previous?.jobId !== retry.jobId ||
        !["failed", "cancelled"].includes(String(previous.status)))
    )
      throw Error("The retry target no longer matches this failed card.");
    if (previous && !["done", "failed", "cancelled"].includes(String(previous.status)))
      throw Error("Another generation is still pending on this card.");
    const cardEdit = "cardEdit" in command ? command.cardEdit : undefined;
    const patches: [string, unknown][] = [];
    const removedEdges: string[] = [];
    const edges = doc.getMap("edges");
    if (cardEdit) {
      if (
        !input ||
        cardEdit.after.modelId !== input.modelId ||
        (typeof input.input.prompt === "string" && cardEdit.after.prompt !== input.input.prompt)
      )
        throw Error("Card edits do not match the generation request.");
      const authoring = canvasAuthoringPatches(doc, data, context.documentBlockId, cardEdit);
      patches.push(...authoring.patches);
      removedEdges.push(...authoring.removedEdges);
    }
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      for (const id of removedEdges) edges.delete(id);
      for (const [name, value] of patches) {
        if (value === null) data.delete(name);
        else data.set(name, value);
      }
      data.set(
        "generation",
        JSON.parse(
          JSON.stringify({
            status: "submitting",
            submissionKey: key,
            submissionOwnerId: command.ownerId,
            ...(input ? { submission: input } : {}),
          })
        )
      );
      if (input && !cardEdit) {
        data.set("modelId", input.modelId);
        if (typeof input.input.prompt === "string") data.set("prompt", input.input.prompt);
      }
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}

/** Autosave never creates or changes a paid-job recovery record. */
function recordCanvasAuthoring(state: string, documentId: string, command: CanvasAuthoring) {
  const { documentBlockId: nodeId, edit } = command.authoring;
  if (command.authoring.documentId !== documentId) throw Error("Card belongs to another document.");
  return withCanvasState(state, [], (doc) => {
    const node = doc.getMap("nodes").get(nodeId);
    const data = node instanceof Y.Map && node.get("data");
    if (
      !(node instanceof Y.Map) ||
      node.get("id") !== nodeId ||
      !(data instanceof Y.Map) ||
      kinds[String(node.get("type"))] !== command.type ||
      data.get("locked") === true
    )
      throw Error("This canvas card cannot be edited.");
    const { patches, removedEdges } = canvasAuthoringPatches(doc, data, nodeId, edit);
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      for (const id of removedEdges) doc.getMap("edges").delete(id);
      for (const [name, value] of patches) {
        if (value === null) data.delete(name);
        else data.set(name, value);
      }
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
