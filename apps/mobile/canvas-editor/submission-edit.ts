import * as Y from "yjs";
import { canvasSubmissionSchema, type CanvasSubmission } from "./submission-schema";
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
export function recordCanvasSubmission(state: string, documentId: string, raw: CanvasSubmission) {
  const command = canvasSubmissionSchema.parse(raw);
  const input = command.submission;
  if (input.context.documentId !== documentId)
    throw Error("Submission belongs to another document.");
  return withCanvasState(state, [], (doc) => {
    const node = doc.getMap("nodes").get(input.context.documentBlockId);
    if (!(node instanceof Y.Map) || node.get("id") !== input.context.documentBlockId)
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
    if (previous?.submissionKey === input.idempotencyKey) {
      if (previous.submission && canonical(previous.submission) !== canonical(input))
        throw Error("The saved generation request changed. Keep the original request.");
      if (previous.submissionOwnerId && previous.submissionOwnerId !== command.ownerId)
        throw Error("This submission belongs to another account.");
      return { ...captureCanvasState(doc), yjsUpdateBase64: null };
    }
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
            submissionKey: input.idempotencyKey,
            submissionOwnerId: command.ownerId,
            submission: input,
          })
        )
      );
      data.set("modelId", input.modelId);
      if (typeof input.input.prompt === "string") data.set("prompt", input.input.prompt);
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
