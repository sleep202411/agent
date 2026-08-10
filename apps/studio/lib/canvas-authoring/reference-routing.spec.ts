import { describe, expect, it } from "vitest";
import type { FizzAiModel } from "./generation-api";
import { evaluateReferenceField, routeReferenceField } from "./reference-routing";

const seedance: FizzAiModel = {
  id: "seedance-2.0",
  type: "video",
  name: "Seedance 2.0",
  enabled: true,
  schemaVersion: "1",
  generationModes: ["text_to_video", "image_to_video", "multimodal_to_video"],
  input_schema: {
    type: "object",
    properties: {
      startFrame: {
        type: "string",
        "x-ui": { control: "image_upload", mediaKind: "image" },
      },
      referenceImages: {
        type: "array",
        maxItems: 9,
        "x-ui": { control: "image_upload", mediaKind: "image" },
      },
      referenceVideos: {
        type: "array",
        maxItems: 3,
        "x-ui": { control: "video_upload", mediaKind: "video" },
      },
    },
  },
};

describe("current-mode reference routing", () => {
  it("rejects Seedance's tenth omni-reference image instead of switching to i2v", () => {
    const references = {
      referenceImages: Array.from({ length: 9 }, (_, index) => ({ id: `image-${index}` })),
    };

    expect(evaluateReferenceField(seedance, "multimodal_to_video", references, "image")).toEqual({
      ok: false,
      issue: { code: "reference_limit", kind: "image", limit: 9 },
    });
    expect(
      routeReferenceField(seedance, "multimodal_to_video", references, "image")
    ).toBeUndefined();
  });

  it("requires an explicit mode change when only another mode accepts the kind", () => {
    expect(evaluateReferenceField(seedance, "text_to_video", {}, "image")).toEqual({
      ok: false,
      issue: {
        code: "current_mode_unsupported",
        kind: "image",
      },
    });
  });

  it("counts unfinished incoming wires as reserved capacity", () => {
    expect(evaluateReferenceField(seedance, "multimodal_to_video", {}, "image", 8)).toEqual({
      ok: true,
      field: "referenceImages",
    });
    expect(evaluateReferenceField(seedance, "multimodal_to_video", {}, "image", 9)).toEqual({
      ok: false,
      issue: { code: "reference_limit", kind: "image", limit: 9 },
    });
  });
});
