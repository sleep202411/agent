import { uuid } from "expo-modules-core";
import {
  canvasCardStateSchema,
  type CanvasCardState,
} from "../../../canvas-editor/card-state-schema";
import type { GenerationDraft } from "./draft";
import type { CanvasGenerationSeed } from "./canvas-seed";
import type { GenerationModel } from "./catalog-api";
import { canvasReferenceFields } from "./canvas-modes";
import { fieldUi } from "./schema";
import { imageReferences, type ImageReference } from "./reference-contract";

/** Convert the reviewed provider input back to Web's authoring representation.
 * Inactive fields stay on the shared card; their unsubmitted edits stay in the draft. */
export function canvasCardEdit(
  seed: CanvasGenerationSeed,
  draft: GenerationDraft,
  model: GenerationModel,
  mode: string | undefined,
  input: Record<string, unknown>
) {
  const before = draft.canvasBase ?? seed.canvasBase ?? canvasCardStateSchema.parse(seed);
  const referenceNames = Object.entries(model.input_schema.properties)
    .filter(([, field]) => {
      const ui = fieldUi(field);
      return (
        ["image_upload", "video_upload", "audio_upload"].includes(ui.control ?? "") ||
        ui.group === "references"
      );
    })
    .map(([name]) => name);
  const active = model.generationModes?.length
    ? canvasReferenceFields(model.input_schema, mode)
    : referenceNames;
  const references: CanvasCardState["references"] = { ...before.references };
  for (const name of active) {
    const field = model.input_schema.properties[name]!;
    const ui = fieldUi(field) as { mediaKind?: string; control?: string };
    const kind =
      ui.mediaKind ??
      (ui.control === "video_upload" ? "video" : ui.control === "audio_upload" ? "audio" : "image");
    const raw = input[name];
    const rows: ImageReference[] =
      field.type === "array" && field.items.type === "object"
        ? imageReferences(draft.values[name])
        : (Array.isArray(raw) ? raw : raw ? [raw] : []).map((url) => ({ url: String(url) }));
    references[name] = rows.map((row) => {
      const metadata = (draft.referenceMedia ?? []).find(
        (item) => item.field === name && item.url === row.url
      );
      const uploaded = (draft.uploadedReferences ?? []).find(
        (item) => item.field === name && item.url === row.url
      );
      const assetId = row.assetId ?? uploaded?.mediaAssetId ?? metadata?.assetId;
      const original = before.references[name]?.find(
        (item) => item.url === row.url || (assetId && item.assetId === assetId)
      );
      // A different URL without durable identity is new media: never retain old edge/asset provenance.
      return JSON.parse(
        JSON.stringify({
          ...original,
          ...row,
          id: row.refId ?? original?.id ?? assetId ?? uuid.v4(),
          kind,
          assetId: assetId ?? original?.assetId,
          durationSeconds:
            row.durationSeconds ??
            uploaded?.durationSeconds ??
            metadata?.durationSeconds ??
            original?.durationSeconds,
          bytes: row.bytes ?? uploaded?.bytes ?? metadata?.bytes ?? original?.bytes,
          width: row.width ?? uploaded?.width ?? original?.width,
          height: row.height ?? uploaded?.height ?? original?.height,
          uploading: false,
        })
      );
    });
  }
  const after = canvasCardStateSchema.parse({
    ...before,
    modelId: model.id,
    mode: mode ?? null,
    prompt: typeof input.prompt === "string" ? input.prompt : before.prompt,
    settings: Object.fromEntries(
      Object.entries(input).filter(([name]) => name !== "prompt" && !referenceNames.includes(name))
    ),
    references,
    skillSelection: draft.skillSelection ?? null,
  });
  return { before, after };
}
