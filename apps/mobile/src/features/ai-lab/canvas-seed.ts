import { z } from "zod";
import type { AiObjectSchema } from "@repo/shared";
import type { CanvasSnapshot } from "../../../canvas-editor/protocol";
import { deriveInitialValues } from "./schema";
import { skillSelection } from "./project-skills";
import { resolveExperienceAssetUrl } from "@/config";

const reference = z.object({
  id: z.string().min(1),
  url: z.string(),
  kind: z.enum(["image", "video", "audio"]).optional(),
  assetId: z.string().optional(),
  label: z.string().optional(),
  uploading: z.boolean().optional(),
  durationSeconds: z.number().finite().nonnegative().nullish(),
  bytes: z.number().finite().nonnegative().nullish(),
  width: z.number().finite().nonnegative().nullish(),
  height: z.number().finite().nonnegative().nullish(),
});
export const canvasReferencesSchema = z.record(z.array(reference));
const dataSchema = z.object({
  prompt: z.string().default(""),
  modelId: z.string().optional(),
  mode: z.string().optional(),
  settings: z.record(z.union([z.string(), z.number().finite(), z.boolean()])).default({}),
  references: canvasReferencesSchema.default({}),
  skillSelection: skillSelection.optional(),
  locked: z.boolean().optional(),
});
export type CanvasGenerationSeed = z.infer<typeof dataSchema>;
export function readCanvasGenerationSeed(snapshot: CanvasSnapshot, nodeId: string) {
  const node = z
    .object({ id: z.string(), type: z.enum(["prompt", "video", "audio"]), data: dataSchema })
    .parse(snapshot.nodes[nodeId]);
  if (node.id !== nodeId) throw Error("Canvas card identity changed.");
  if (node.data.locked) throw Error("This canvas card is locked.");
  return { mode: node.type === "prompt" ? ("image" as const) : node.type, seed: node.data };
}
function readyReference(row: z.infer<typeof reference>) {
  if (row.uploading) throw Error("Finish uploading the canvas references before generating.");
  try {
    const url = new URL(row.url);
    if (url.protocol === "https:" || url.protocol === "http:") return row;
  } catch {
    // A cached preview is not the durable identity of an uploaded asset.
  }
  if (row.assetId)
    return {
      ...row,
      url: resolveExperienceAssetUrl(
        `/aurora/media/assets/${encodeURIComponent(row.assetId)}/content`
      ),
    };
  throw Error("This canvas reference is unavailable. Select or upload it again.");
}
/** Seed a new composer draft; never overwrite an existing per-card draft. */
export function canvasSeedDraft(
  seed: CanvasGenerationSeed,
  modelId: string,
  schema: AiObjectSchema,
  activeReferenceFields?: readonly string[]
) {
  const values = deriveInitialValues(schema);
  const deferredCanvasReferences: CanvasGenerationSeed["references"] = {};
  if (seed.modelId === modelId)
    for (const [name, value] of Object.entries(seed.settings))
      if (Object.hasOwn(schema.properties, name)) values[name] = value;
  if (schema.properties.prompt) values.prompt = seed.prompt;
  else if (seed.prompt) throw Error("This model cannot accept the canvas prompt.");
  const counts = { image: 0, video: 0, audio: 0 };
  const referenceMedia: {
    field: string;
    kind: "image" | "video" | "audio";
    url: string;
    assetId?: string;
    durationSeconds?: number;
    bytes?: number;
  }[] = [];
  for (const [name, sourceRows] of Object.entries(seed.references)) {
    if (!sourceRows.length) continue;
    if (activeReferenceFields && !activeReferenceFields.includes(name)) {
      deferredCanvasReferences[name] = sourceRows;
      continue;
    }
    const rows = sourceRows.map(readyReference);
    const field = schema.properties[name];
    if (!field) throw Error(`This model does not accept the canvas reference field ${name}.`);
    const entries = rows.map((row) => {
      const kind =
        row.kind ??
        (name.toLowerCase().includes("audio")
          ? "audio"
          : name.toLowerCase().includes("video")
            ? "video"
            : "image");
      referenceMedia.push({
        field: name,
        kind,
        url: row.url,
        assetId: row.assetId,
        durationSeconds: row.durationSeconds ?? undefined,
        bytes: row.bytes ?? undefined,
      });
      if (!["startFrame", "firstFrame", "endFrame", "lastFrame"].includes(name)) counts[kind]++;
      const prefix = kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio";
      return Object.fromEntries(
        Object.entries({
          url: row.url,
          refId: row.id,
          label: row.label ?? `${prefix}${counts[kind]}`,
          assetId: row.assetId,
          durationSeconds: row.durationSeconds,
          bytes: row.bytes,
          width: row.width,
          height: row.height,
        }).filter(([, value]) => value != null)
      );
    });
    if (field.type === "array" && field.items.type === "object") values[name] = entries;
    else if (field.type === "array" && field.items.type === "string")
      values[name] = rows.map((row) => row.url).join("\n");
    else if (field.type === "string" && rows.length === 1) values[name] = rows[0]!.url;
    else throw Error(`This model cannot represent the canvas references in ${name}.`);
  }
  return {
    values,
    referenceMedia,
    ...(Object.keys(deferredCanvasReferences).length ? { deferredCanvasReferences } : {}),
    ...(seed.skillSelection ? { skillSelection: seed.skillSelection } : {}),
  };
}
