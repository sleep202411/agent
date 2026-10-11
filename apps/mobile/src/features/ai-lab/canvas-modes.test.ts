import { expect, it } from "vitest";
import type { AiJsonSchema, AiObjectSchema } from "@repo/shared";
import type { GenerationModel } from "./catalog-api";
import { canvasModeForm, canvasReferenceFields, initialCanvasMode } from "./canvas-modes";
import { prepareFormValues } from "./form-values";
const reference = (control: "image_upload" | "video_upload" | "audio_upload"): AiJsonSchema => ({
  type: "array",
  maxItems: 4,
  items: { type: "string", format: "uri" },
  "x-ui": { control },
});
const schema: AiObjectSchema = {
  type: "object",
  required: ["prompt", "startFrame", "referenceAudios"],
  properties: {
    prompt: { type: "string" },
    startFrame: { type: "string", format: "uri", "x-ui": { control: "image_upload" } },
    endFrame: { type: "string", format: "uri", "x-ui": { control: "image_upload" } },
    referenceImages: reference("image_upload"),
    referenceVideos: reference("video_upload"),
    referenceAudios: reference("audio_upload"),
    maskImage: reference("image_upload"),
    sourceVideo: reference("video_upload"),
  },
};
const model: GenerationModel = {
  id: "model",
  name: "Model",
  type: "video",
  enabled: true,
  schemaVersion: "1",
  input_schema: schema,
  generationModes: ["text_to_video", "image_to_video", "multimodal_to_video"],
};
it.each([
  ["text_to_video", []],
  ["text_to_image", []],
  ["text_to_audio", []],
  ["first_last_frame_to_video", ["startFrame", "endFrame"]],
  ["multimodal_to_video", ["referenceImages", "referenceVideos", "referenceAudios"]],
  ["image_to_video", ["startFrame"]],
  ["image_to_panorama", ["startFrame"]],
  ["image_to_image", ["referenceImages"]],
  ["video_to_video", ["sourceVideo", "referenceVideos"]],
  ["inpainting", ["referenceImages", "maskImage"]],
  ...["upscale", "remove_background", "relight", "multi_angle", "outpainting"].map((mode) => [
    mode,
    ["referenceImages"],
  ]),
] as [string, string[]][])("matches Studio reference roles for %s", (mode, fields) => {
  expect(canvasReferenceFields(schema, mode)).toEqual(fields);
});
it("preserves inactive drafts but excludes their required rules and malformed values from submission", () => {
  const raw = {
    prompt: "Lake",
    startFrame: "file:///pending.png",
    referenceAudios: "invalid JSON",
    referenceImages: "https://example.com/a.png",
  };
  const before = JSON.stringify(raw);
  const form = canvasModeForm(model, "text_to_video", raw);
  expect(prepareFormValues(form.schema, form.values)).toEqual({ prompt: "Lake" });
  expect(JSON.stringify(raw)).toBe(before);
  const frames = canvasModeForm(model, "first_last_frame_to_video", raw);
  expect(() => prepareFormValues(frames.schema, frames.values)).toThrow();
  const unknown = canvasModeForm(model, "text_to_video", { ...raw, retiredParameter: 2 });
  expect(() => prepareFormValues(unknown.schema, unknown.values)).toThrow("retiredParameter");
});
it("uses reference-friendly defaults, honors supported saved modes and preserves legacy catalogs", () => {
  expect(initialCanvasMode(model)).toBe("multimodal_to_video");
  expect(initialCanvasMode(model, "text_to_video")).toBe("text_to_video");
  expect(initialCanvasMode(model, "removed")).toBe("multimodal_to_video");
  expect(
    initialCanvasMode({
      ...model,
      type: "image",
      generationModes: ["text_to_image", "image_to_image"],
    })
  ).toBe("image_to_image");
  expect(
    canvasModeForm({ ...model, generationModes: undefined }, undefined, { prompt: "hi" }).schema
  ).toBe(schema);
});
it("keeps unknown mode fields in schema order and uses Studio fallback roles", () => {
  const custom: AiObjectSchema = {
    type: "object",
    properties: {
      zImage: { ...reference("image_upload"), "x-ui": { control: "image_upload", order: 1 } },
      aImage: reference("image_upload"),
      customFrame: reference("image_upload"),
      customAudio: reference("audio_upload"),
    },
  };
  expect(canvasReferenceFields(custom, "future_mode")).toEqual([
    "zImage",
    "aImage",
    "customAudio",
    "customFrame",
  ]);
  expect(canvasReferenceFields(custom, "image_to_video")).toEqual(["zImage"]);
  expect(canvasReferenceFields(custom, "first_last_frame_to_video")).toEqual(["customFrame"]);
  expect(canvasReferenceFields(custom, "image_to_image")).toEqual(["zImage", "aImage"]);
});
