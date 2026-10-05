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
  input: Record<string, unknown>,
  includeInactive = false
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
  const fields = includeInactive
    ? referenceNames.filter(
        (name) =>
          active.includes(name) ||
          (Object.hasOwn(draft.values, name) &&
            !Object.hasOwn(draft.deferredCanvasReferences ?? {}, name))
      )
    : active;
  for (const name of fields) {
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

/** Parse editable authoring values without requiring a complete paid-job input. */
export function canvasAuthoringEdit(
  seed: CanvasGenerationSeed,
  draft: GenerationDraft,
  model: GenerationModel,
  mode: string | undefined
) {
  const input: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(draft.values)) {
    if (raw === undefined) continue;
    const field = model.input_schema.properties[name];
    if (!field) throw Error("Review the changed model settings before syncing this draft.");
    let value = raw;
    if (typeof raw === "string") {
      if (field.type === "number" || field.type === "integer") {
        if (!raw.trim()) continue;
        value = Number(raw);
        if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value)))
          throw Error("Finish entering a valid number before syncing this draft.");
      } else if (field.type === "array")
        value =
          field.items.type === "string"
            ? raw
                .split(/\r?\n/)
                .map((v) => v.trim())
                .filter(Boolean)
            : JSON.parse(raw);
      else if (field.type === "object") value = JSON.parse(raw);
    }
    input[name] = value;
  }
  const edit = canvasCardEdit(seed, draft, model, mode, input, true);
  for (const rows of Object.values(edit.after.references))
    for (const row of rows) {
      // Unchanged/deferred Web references are retained, even if their old URL expired.
      if (
        Object.values(edit.before.references)
          .flat()
          .some((old) => JSON.stringify(old) === JSON.stringify(row))
      )
        continue;
      if (row.uploading || typeof row.url !== "string" || !/^https?:\/\//i.test(row.url))
        throw Error("Finish selecting or uploading references before syncing this draft.");
      new URL(row.url);
    }
  return edit;
}
