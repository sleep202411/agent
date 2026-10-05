import { expect, it, vi } from "vitest";
import { canvasCardEdit } from "./canvas-card-edit";
import { canvasCardStateSchema } from "../../../canvas-editor/card-state-schema";
import type { GenerationDraft } from "./draft";
import type { GenerationModel } from "./catalog-api";
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "new-reference" } }));
const model: GenerationModel = {
  id: "model",
  name: "Model",
  type: "image",
  enabled: true,
  schemaVersion: "1",
  generationModes: ["image_to_image", "text_to_image"],
  input_schema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      seed: { type: "integer" },
      referenceImages: {
        type: "array",
        maxItems: 4,
        items: { type: "object", properties: { url: { type: "string" } } },
        "x-ui": { control: "image_upload" },
      },
    },
  },
};
const base = canvasCardStateSchema.parse({
  modelId: "old-model",
  prompt: "Old",
  mode: "text_to_image",
  settings: { seed: 7 },
  references: {
    referenceImages: [
      {
        id: "ref",
        url: "https://example.com/old.png",
        edgeId: "edge",
        sourceNodeId: "source",
        assetId: "asset",
      },
    ],
    startFrame: [{ id: "frame", url: "https://example.com/frame.png" }],
  },
});
const seed = { prompt: "Old", settings: {}, references: {}, canvasBase: base };
const draft: GenerationDraft = {
  mode: "image",
  generationMode: "image_to_image",
  modelId: "model",
  presetId: "preset",
  schemaVersion: "1",
  values: {
    prompt: "Lake",
    referenceImages: [{ refId: "ref", url: "https://example.com/new.png" }],
  },
};
it("persists active references and reviewed settings while preserving inactive card inputs", () => {
  const edit = canvasCardEdit(seed, draft, model, "image_to_image", {
    prompt: "Lake",
    seed: 0,
    referenceImages: [{ url: "https://example.com/new.png" }],
  });
  expect(edit.after).toMatchObject({
    prompt: "Lake",
    modelId: "model",
    mode: "image_to_image",
    settings: { seed: 0 },
  });
  expect(edit.after.references.referenceImages).toEqual([
    {
      refId: "ref",
      id: "ref",
      url: "https://example.com/new.png",
      kind: "image",
      uploading: false,
    },
  ]);
  expect(edit.after.references.startFrame).toEqual(base.references.startFrame);
  expect(edit.before.references.referenceImages?.[0]?.edgeId).toBe("edge");
  expect(edit.after.settings).not.toHaveProperty("referenceImages");
});
it("retains durable identities and connections for unchanged media and clears active removals", () => {
  const values = { prompt: "Lake", referenceImages: [{ url: "https://example.com/old.png" }] };
  const edit = canvasCardEdit(seed, { ...draft, values }, model, "image_to_image", values);
  expect(edit.after.references.referenceImages?.[0]).toMatchObject({
    id: "ref",
    edgeId: "edge",
    sourceNodeId: "source",
    assetId: "asset",
  });
  const removed = canvasCardEdit(seed, { ...draft, values: {} }, model, "image_to_image", {
    prompt: "Lake",
  });
  expect(removed.after.references.referenceImages).toEqual([]);
  expect(removed.after.settings).toEqual({});
});
it("does not parse or overwrite inactive draft references in a text-only request", () => {
  const edit = canvasCardEdit(
    seed,
    { ...draft, values: { referenceImages: "invalid JSON" } },
    model,
    "text_to_image",
    { prompt: "Lake" }
  );
  expect(edit.after.references).toEqual(base.references);
});
