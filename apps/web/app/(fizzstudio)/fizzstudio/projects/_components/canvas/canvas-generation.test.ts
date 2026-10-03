import { describe, expect, it } from "vitest";
import type { FizzAiModel } from "../../../../_lib/generation-api";
import {
  canvasGenerationInput,
  currentCanvasGenerationModel,
  invalidCanvasGenerationFields,
} from "./canvas-generation";

const model: FizzAiModel = {
  id: "chosen",
  name: "Chosen",
  type: "video",
  enabled: true,
  schemaVersion: "2",
  input_schema: {
    required: ["prompt", "seconds"],
    additionalProperties: false,
    properties: {
      prompt: { type: "string", maxLength: 20 },
      seconds: { type: "integer", minimum: 1, maximum: 10 },
      quality: { type: "string", enum: ["standard", "high"] },
      resolution: { type: "string", enum: ["720p", "1080p"] },
      audio: { type: "boolean" },
      seed: { type: "integer", minimum: 0 },
      startFrame: { type: "object", "x-ui": { mediaKind: "image" } },
    },
  },
};
const request = { modelId: "chosen", schemaVersion: "2", input: { prompt: "film", seconds: 5 } };
describe("canvas reviewed generation command", () => {
  it("uses the chosen model even when another model is first", () => {
    expect(
      currentCanvasGenerationModel({ models: [{ ...model, id: "first" }, model] }, "video", request)
    ).toBe(model);
  });
  it.each([
    { enabled: false },
    { access: { allowed: false } },
    { schemaVersion: "3" },
    { id: "replacement" },
    { type: "image" as const },
  ])("rejects changed availability/schema/type without substitution: %j", (change) => {
    expect(
      currentCanvasGenerationModel({ models: [{ ...model, ...change }] }, "video", request)
    ).toBeNull();
  });
  it("preserves reviewed quality, resolution, false and zero and uses the selected reference slot", () => {
    const input = canvasGenerationInput(
      model,
      {
        prompt: " film ",
        modelId: model.id,
        settings: { seconds: 5, quality: "high", resolution: "1080p", audio: false, seed: 0 },
        referenceField: "startFrame",
      },
      "https://example.test/frame.png"
    );
    expect(input).toEqual({
      prompt: "film",
      seconds: 5,
      quality: "high",
      resolution: "1080p",
      audio: false,
      seed: 0,
      startFrame: { url: "https://example.test/frame.png" },
    });
    expect(invalidCanvasGenerationFields(model, input)).toEqual([]);
  });
  it("makes stale/invalid settings actionable instead of silently deleting them", () => {
    expect(
      invalidCanvasGenerationFields(model, {
        seconds: 15,
        quality: "invented",
        audio: "false",
        seed: 0.5,
        obsolete: true,
      })
    ).toEqual(["prompt", "seconds", "quality", "audio", "seed", "obsolete"]);
  });
  it("respects array/string reference schemas and omits unselected references", () => {
    const image: FizzAiModel = {
      ...model,
      input_schema: {
        properties: { referenceImages: { type: "array", items: { type: "string" } } },
      },
    };
    const draft = {
      prompt: "film",
      modelId: model.id,
      settings: {},
      referenceField: "referenceImages",
    };
    expect(canvasGenerationInput(image, draft, "url")).toEqual({
      prompt: "film",
      referenceImages: ["url"],
    });
    expect(canvasGenerationInput(image, { ...draft, referenceField: "" }, "url")).toEqual({
      prompt: "film",
    });
  });
});
