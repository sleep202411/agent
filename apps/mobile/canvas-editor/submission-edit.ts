import * as Y from "yjs";
import { canvasSubmissionRecordSchema, type CanvasSubmissionRecord } from "./submission-schema";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";
const kinds: Record<string, string> = { prompt: "image", video: "video", audio: "audio" };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Persist the same recovery record as Web before the host sends a paid job. */
export function recordCanvasSubmission(
  state: string,
  documentId: string,
  raw: CanvasSubmissionRecord
) {
  const command = canvasSubmissionRecordSchema.parse(raw);
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
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
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
      if (input) {
        data.set("modelId", input.modelId);
        if (typeof input.input.prompt === "string") data.set("prompt", input.input.prompt);
      }
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
