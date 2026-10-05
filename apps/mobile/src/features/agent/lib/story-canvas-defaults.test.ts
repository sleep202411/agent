import { expect, it } from "vitest";
import { canvasGenerationDefaults } from "./story-canvas-defaults";
import type { GenerationModel } from "@/features/ai-lab/catalog-api";
function model(id: string, type: GenerationModel["type"], modes: string[] = []): GenerationModel {
  return {
    id,
    name: id,
    type,
    enabled: true,
    schemaVersion: "1",
    generationModes: modes,
    input_schema: { type: "object", properties: {} },
  };
}
it("matches Web's preferred video model then reference-friendly fallback", () => {
  const text = model("text", "video", ["text_to_video"]),
    ref = model("ref", "video", ["image_to_video"]),
    wan = model("wan-3-0", "video", ["text_to_video", "multimodal_to_video"]);
  expect(canvasGenerationDefaults([text, ref, wan], "video")).toMatchObject({
    modelId: wan.id,
    mode: "multimodal_to_video",
  });
  wan.access = { allowed: false };
  expect(canvasGenerationDefaults([text, ref, wan], "video")).toMatchObject({
    modelId: ref.id,
    mode: "image_to_video",
  });
  ref.enabled = false;
  expect(canvasGenerationDefaults([text, ref, wan], "video")).toMatchObject({
    modelId: text.id,
    mode: "text_to_video",
  });
});
it("does not invent a model when none is available", () => {
  expect(canvasGenerationDefaults([model("video", "video")], "image")).toEqual({ settings: {} });
});
it("seeds schema defaults while excluding prompt/references and leaving random seed absent", () => {
  const image = model("image", "image", ["text_to_image", "image_to_image"]);
  image.input_schema.properties = {
    prompt: { type: "string", default: "Do not copy" },
    seed: { type: "integer", minimum: 0 },
    ratio: { type: "string", enum: ["1:1", "16:9"] },
    watermark: { type: "boolean" },
    count: { type: "integer", default: 2 },
    refs: {
      type: "array",
      items: { type: "string" },
      default: [],
      "x-ui": { group: "references" },
    },
    upload: { type: "string", default: "media", "x-ui": { control: "image_upload" } },
    resolution: {
      type: "string",
      enum: ["small"],
      "x-ui": { options: [{ value: "large", label: "Large" }] },
    },
  } as GenerationModel["input_schema"]["properties"];
  expect(canvasGenerationDefaults([image], "image")).toEqual({
    modelId: "image",
    modelName: "image",
    mode: "image_to_image",
    settings: { ratio: "1:1", watermark: false, count: 2, resolution: "large" },
  });
});
it("uses audio modes and rejects duplicate or malformed models", () => {
  const audio = model("audio", "audio", ["audio_to_audio", "text_to_audio"]);
  expect(canvasGenerationDefaults([audio], "audio").mode).toBe("text_to_audio");
  expect(() => canvasGenerationDefaults([audio, audio], "audio")).toThrow("Duplicate");
  // Deliberately malformed runtime catalog data.
  audio.generationModes = 1 as unknown as string[];
  expect(() => canvasGenerationDefaults([audio], "audio")).toThrow();
});
