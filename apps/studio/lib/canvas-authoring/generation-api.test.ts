import { describe, expect, it } from "vitest";
import { buildPromptReferenceBindingsForMode, buildReferenceInputForMode } from "./generation-api";
import type { FizzAiModel } from "./generation-api";

/**
 * A Seedance-2.0-shaped catalog entry: ONE flat schema carrying every mode's
 * reference fields. The provider's three image scenarios (first frame /
 * first+last frames / multimodal references) are mutually exclusive, but a flat
 * JSON Schema cannot express that — the mode→field narrowing here is the only
 * thing keeping them apart, which is why it is worth pinning.
 */
function seedanceLikeModel(): FizzAiModel {
  const upload = (kind: "image" | "video" | "audio", order: number) => ({
    control: `${kind}_upload` as const,
    group: "references" as const,
    kind,
    order,
  });
  return {
    id: "seedance-2-0",
    type: "video",
    generationModes: [
      "text_to_video",
      "image_to_video",
      "first_last_frame_to_video",
      "multimodal_to_video",
    ],
    input_schema: {
      properties: {
        prompt: { type: "string" },
        startFrame: { type: "string", "x-ui": upload("image", 1) },
        endFrame: { type: "string", "x-ui": upload("image", 2) },
        referenceImages: {
          type: "array",
          maxItems: 9,
          "x-ui": upload("image", 3),
        },
        referenceVideos: {
          type: "array",
          maxItems: 3,
          "x-ui": upload("video", 4),
        },
      },
    },
  } as unknown as FizzAiModel;
}

const startRow = {
  id: "ref-start",
  url: "https://cdn.example.com/a-last-frame.png",
  assetId: "asset-start",
};
const endRow = {
  id: "ref-end",
  url: "https://cdn.example.com/b-end-frame.png",
  assetId: "asset-end",
};
const imageRow = {
  id: "ref-image",
  url: "https://cdn.example.com/steward-sheet.png",
  assetId: "asset-image",
};

describe("buildReferenceInputForMode", () => {
  it("emits only the frame fields for the first/last-frame scenario", () => {
    const input = buildReferenceInputForMode(seedanceLikeModel(), "first_last_frame_to_video", {
      startFrame: [startRow],
      endFrame: [endRow],
      referenceImages: [imageRow],
    });
    expect(Object.keys(input).sort()).toEqual(["endFrame", "startFrame"]);
  });

  it("emits only the reference arrays for the multimodal scenario", () => {
    const input = buildReferenceInputForMode(seedanceLikeModel(), "multimodal_to_video", {
      startFrame: [startRow],
      referenceImages: [imageRow],
    });
    expect(Object.keys(input)).toEqual(["referenceImages"]);
    expect(input.referenceImages).toEqual([
      { url: imageRow.url, assetId: imageRow.assetId, refId: imageRow.id },
    ]);
  });

  it("keeps a single frame as one object, not an array", () => {
    const input = buildReferenceInputForMode(seedanceLikeModel(), "image_to_video", {
      startFrame: [startRow],
    });
    expect(input.startFrame).toEqual({
      url: startRow.url,
      assetId: startRow.assetId,
      refId: startRow.id,
    });
  });
});

describe("buildPromptReferenceBindingsForMode", () => {
  /**
   * Regression: binding a frame made the server materialize it back into
   * `input.referenceImages`, so the same asset arrived as BOTH `startFrame` and
   * a reference image and the provider rejected the request
   * (`first/last frame content cannot be mixed with reference media content`).
   * Frames are positional roles; `[Image1]` tokens belong to multimodal refs.
   */
  it("never binds start/end frames", () => {
    expect(
      buildPromptReferenceBindingsForMode(seedanceLikeModel(), "first_last_frame_to_video", {
        startFrame: [startRow],
        endFrame: [endRow],
      })
    ).toEqual([]);
    expect(
      buildPromptReferenceBindingsForMode(seedanceLikeModel(), "image_to_video", {
        startFrame: [startRow],
      })
    ).toEqual([]);
  });

  it("binds multimodal references with per-kind [ImageN] labels", () => {
    const bindings = buildPromptReferenceBindingsForMode(
      seedanceLikeModel(),
      "multimodal_to_video",
      {
        referenceImages: [imageRow, { ...imageRow, id: "ref-image-2" }],
        referenceVideos: [{ id: "ref-video", url: "https://cdn.example.com/a.mp4" }],
      }
    );
    expect(bindings.map((binding) => binding.label)).toEqual(["Image1", "Image2", "Video1"]);
  });

  it("skips rows still uploading or without an http(s) url", () => {
    const bindings = buildPromptReferenceBindingsForMode(
      seedanceLikeModel(),
      "multimodal_to_video",
      {
        referenceImages: [
          { ...imageRow, uploading: true },
          { id: "blob-row", url: "blob:http://localhost/abc" },
        ],
      }
    );
    expect(bindings).toEqual([]);
  });
});
