import * as Y from "yjs";
import { canvasGenerationJobSchema, type CanvasGenerationJob } from "./generation-schema";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";

const kinds: Record<string, string> = { prompt: "image", video: "video", audio: "audio" };
const terminal = new Set(["done", "failed", "cancelled"]);
function status(raw: CanvasGenerationJob["status"]) {
  if (raw === "completed") return "done";
  if (raw === "failed" || raw === "expired") return "failed";
  if (raw === "cancelled" || raw === "canceled") return "cancelled";
  return raw === "in_progress" || raw === "running" ? "generating" : "queued";
}
/** Host verifies project/auth ownership and fetches the authoritative job first.
 * This operation only encodes a delta; it never sends jobs or writes remotely. */
export function applyCanvasGeneration(state: string, documentId: string, raw: CanvasGenerationJob) {
  const job = canvasGenerationJobSchema.parse(raw);
  if (job.documentId !== documentId) throw Error("Generation belongs to another document.");
  return withCanvasState(state, [], (doc) => {
    const node = doc.getMap("nodes").get(job.documentBlockId);
    if (!(node instanceof Y.Map) || node.get("id") !== job.documentBlockId)
      throw Error("Generation card is unavailable. Reload the document.");
    const data = node.get("data");
    if (!(data instanceof Y.Map) || kinds[String(node.get("type"))] !== job.type)
      throw Error("Generation does not match this card.");
    const previous = data.get("generation") as Record<string, unknown> | undefined;
    if (previous != null && (typeof previous !== "object" || Array.isArray(previous)))
      throw Error("Generation card state is invalid.");
    if (
      previous?.jobId
        ? previous.jobId !== job.id
        : previous?.submissionKey
          ? previous.submissionKey !== job.idempotencyKey
          : data.get("modelId") !== job.modelId ||
            (previous && terminal.has(String(previous.status)))
    )
      throw Error("Generation was replaced by another run.");
    const nextStatus = status(job.status);
    // Late running events cannot regress a completed/failed/cancelled card.
    if (previous && terminal.has(String(previous.status)) && !terminal.has(nextStatus))
      return { ...captureCanvasState(doc), yjsUpdateBase64: null };
    const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    const next = clean({
      jobId: job.id,
      submissionKey: job.idempotencyKey ?? previous?.submissionKey,
      status: nextStatus,
      progress: job.progress,
      queuePosition: job.queuePosition,
      etaSeconds: job.estimatedTotalSeconds,
      outputs: job.outputs.map(({ id: _id, ...output }) => output),
      errorCode: job.error?.code,
      error: job.error?.userMessage,
    });
    const assets = doc.getMap("assets");
    // Validate collisions before mutating either the card or shared library.
    const additions =
      nextStatus === "done"
        ? job.outputs.map((output) => {
            const existing = assets.get(output.id) as Record<string, unknown> | undefined;
            if (
              existing &&
              (existing.source !== "generated" ||
                (!output.assetId && existing.url !== output.url) ||
                existing.mediaAssetId !== output.assetId ||
                existing.kind !== output.type)
            )
              throw Error("Generated media conflicts with an existing canvas asset.");
            return {
              id: output.id,
              existing,
              value: clean({
                id: output.id,
                mediaAssetId: output.assetId,
                kind: output.type,
                source: "generated",
                url: output.url,
                width: output.width,
                height: output.height,
                durationSeconds: output.durationSeconds,
                bytes: output.bytes,
                prompt: job.prompt,
                createdAt: Date.parse(job.createdAt),
                category: "general",
              }),
            };
          })
        : [];
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      if (JSON.stringify(previous) !== JSON.stringify(next)) data.set("generation", next);
      // Preserve user-renamed media and avoid duplicate writes on reconciliation.
      for (const asset of additions) {
        if (!asset.existing) assets.set(asset.id, asset.value);
        else if (asset.existing.url !== asset.value.url)
          assets.set(asset.id, { ...asset.existing, url: asset.value.url });
      }
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
