import * as Y from "yjs";
import { z } from "zod";
import type { CanvasGenerationJob } from "./generation-schema";

const references = z.record(
  z.string(),
  z.array(z.object({ edgeId: z.string().optional() }).passthrough())
);
/** Compute patches before the source/library transaction. Slots are rechecked
 * against fresh CRDT data; stale catalog projections never change a new mode. */
export function generationReferencePatches(doc: Y.Doc, job: CanvasGenerationJob) {
  const patches = new Map<Y.Map<unknown>, z.infer<typeof references>>();
  const output = job.outputs[0];
  if (job.status !== "completed" || !output) return patches;
  for (const [id, edge] of doc.getMap("edges")) {
    if (
      !(edge instanceof Y.Map) ||
      edge.get("id") !== id ||
      edge.get("source") !== job.documentBlockId
    )
      continue;
    const targetId = edge.get("target");
    if (typeof targetId !== "string" || targetId === job.documentBlockId) continue;
    const slots = job.referenceTargets?.[targetId];
    const node = doc.getMap("nodes").get(targetId);
    if (
      !slots ||
      !(node instanceof Y.Map) ||
      node.get("id") !== targetId ||
      !["prompt", "video", "audio"].includes(String(node.get("type")))
    )
      continue;
    const data = node.get("data");
    if (
      !(data instanceof Y.Map) ||
      data.get("modelId") !== slots.modelId ||
      data.get("mode") !== slots.mode
    )
      continue;
    const parsed = references.safeParse(patches.get(data) ?? data.get("references") ?? {});
    if (!parsed.success) continue;
    const previous = parsed.data;
    const filtered = Object.fromEntries(
      Object.entries(previous).map(([key, rows]) => [key, rows.filter((row) => row.edgeId !== id)])
    );
    const field = slots.fields.find(
      (slot) => slot.kind === output.type && (filtered[slot.field]?.length ?? 0) < slot.maxItems
    )?.field;
    if (!field) continue;
    const value = JSON.parse(
      JSON.stringify({
        id,
        edgeId: id,
        sourceNodeId: job.documentBlockId,
        url: output.url,
        kind: output.type,
        name: job.prompt.trim() || undefined,
        assetId: output.assetId,
        durationSeconds: output.durationSeconds,
        bytes: output.bytes,
        width: output.width,
        height: output.height,
      })
    );
    const next = { ...filtered, [field]: [...(filtered[field] ?? []), value] };
    if (JSON.stringify(previous) !== JSON.stringify(next)) patches.set(data, next);
  }
  for (const [data, next] of patches) {
    if (JSON.stringify(data.get("references") ?? {}) === JSON.stringify(next)) patches.delete(data);
  }
  return patches;
}
