import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReferenceInputError,
  buildPromptDocument,
  buildPromptReferenceBindingsForMode,
  buildReferenceInputForMode,
  referenceFieldsForMode,
  mediaSnapshotsForMode,
} from "./generation-api";
import type { FizzAiModel } from "./generation-api";

describe("buildPromptDocument", () => {
  it("preserves Skill entities as installation references, not prompt instructions", () => {
    expect(
      buildPromptDocument("Paint @Image1 with /Ink Wash", [
        { refId: "asset-1", label: "Image1" },
        {
          refId: "10000000-0000-7000-8000-000000000001",
          label: "Ink Wash",
          nodeType: "skill_ref",
        },
      ])
    ).toEqual({
      version: 1,
      nodes: [
        { type: "text", text: "Paint " },
        { type: "asset_ref", refId: "asset-1", label: "Image1" },
        { type: "text", text: " with " },
        {
          type: "skill_ref",
          refId: "10000000-0000-7000-8000-000000000001",
          label: "Ink Wash",
        },
      ],
    });
  });
});

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
        referenceAudios: {
          type: "array",
          maxItems: 3,
          "x-ui": upload("audio", 5),
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
  it("retains existing HappyHorse reference slots when Server adds an internal typed alias", () => {
    const model: FizzAiModel = {
      ...seedanceLikeModel(),
      id: "happyhorse-1-0",
      generationModes: ["multimodal_to_video"],
      input_schema: {
        properties: {
          references: {
            type: "array",
            maxItems: 4,
            "x-ui": { control: "media_upload", group: "references", order: 30 },
          },
          referenceImages: {
            type: "array",
            maxItems: 4,
            "x-ui": { control: "hidden", group: "internal", mediaKind: "image", order: 30 },
          },
        },
      },
    };
    expect(
      referenceFieldsForMode(model, "multimodal_to_video").map((field) => field.field)
    ).toEqual(["references"]);
    expect(
      buildReferenceInputForMode(model, "multimodal_to_video", {
        references: [{ id: "existing-reference", url: "https://media.example.com/character.png" }],
      })
    ).toEqual({ references: ["https://media.example.com/character.png"] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("submits all five media-panel images alongside two audio references", () => {
    vi.stubGlobal("window", { location: { origin: "https://studio.fizzdragon.com" } });
    const model = seedanceLikeModel();
    const references = {
      referenceImages: Array.from({ length: 5 }, (_, i) => ({
        id: `image-${i}`,
        assetId: `asset-${i}`,
        kind: "image" as const,
        url: `/aurora/media/assets/asset-${i}/content?variantKey=original`,
      })),
      referenceAudios: Array.from({ length: 2 }, (_, i) => ({
        id: `audio-${i}`,
        assetId: `audio-asset-${i}`,
        kind: "audio" as const,
        url: `https://cdn.example.com/audio-${i}.mp3`,
        durationSeconds: 4,
      })),
    };
    const input = buildReferenceInputForMode(model, "multimodal_to_video", references);
    expect(input.referenceImages).toHaveLength(5);
    expect(input.referenceAudios).toHaveLength(2);
    expect((input.referenceImages as unknown[])[0]).toEqual({
      assetId: "asset-0",
      refId: "image-0",
      url: "https://studio.fizzdragon.com/aurora/media/assets/asset-0/content",
    });
    const bindings = buildPromptReferenceBindingsForMode(model, "multimodal_to_video", references);
    expect(bindings.map((b) => b.label)).toEqual([
      "Image1",
      "Image2",
      "Image3",
      "Image4",
      "Image5",
      "Audio1",
      "Audio2",
    ]);
    expect(mediaSnapshotsForMode(model, "multimodal_to_video", references)).toHaveLength(7);
    expect(references.referenceImages[0].url).toBe(
      "/aurora/media/assets/asset-0/content?variantKey=original"
    );
    expect(
      buildReferenceInputForMode(model, "image_to_video", {
        startFrame: [references.referenceImages[0]],
      }).startFrame
    ).toEqual((input.referenceImages as unknown[])[0]);
  });

  it.each([
    { id: "upload", url: "https://cdn.example.com/preview", uploading: true },
    { id: "blob", url: "blob:https://studio.fizzdragon.com/upload" },
    { id: "relative", url: "/account" },
    { id: "broken", url: "https://" },
    { id: "empty", url: "" },
  ])("never silently drops an unresolved selected reference: $id", (row) => {
    const references = { referenceImages: [imageRow, row] };
    for (const build of [
      buildReferenceInputForMode,
      buildPromptReferenceBindingsForMode,
      mediaSnapshotsForMode,
    ]) {
      expect(() => build(seedanceLikeModel(), "multimodal_to_video", references)).toThrow(
        ReferenceInputError
      );
    }
  });

  it.each([
    "https://studio.fizzdragon.com",
    "https://studio.fizzspace.cn",
    "http://localhost:9540",
  ])("uses asset identity for every media kind on %s", (origin) => {
    vi.stubGlobal("window", { location: { origin } });
    const references = {
      referenceImages: [{ id: "image", assetId: "image-asset", url: "blob:expired" }],
      referenceVideos: [{ id: "video", assetId: "video-asset", url: "/old-preview" }],
      referenceAudios: [{ id: "audio", assetId: "audio-asset", url: "" }],
    };
    const input = buildReferenceInputForMode(
      seedanceLikeModel(),
      "multimodal_to_video",
      references
    );
    const bindings = buildPromptReferenceBindingsForMode(
      seedanceLikeModel(),
      "multimodal_to_video",
      references
    );
    const snapshots = mediaSnapshotsForMode(seedanceLikeModel(), "multimodal_to_video", references);
    expect(bindings.map((b) => b.url)).toEqual(snapshots.map((r) => r.url));
    expect((Object.values(input).flat() as { url: string }[]).map((r) => r.url)).toEqual(
      bindings.map((b) => b.url)
    );
    expect(bindings.map((b) => b.url)).toEqual(
      ["image", "video", "audio"].map(
        (kind) => `${origin}/aurora/media/assets/${kind}-asset/content`
      )
    );
  });

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

  it("preserves composer mention labels after removing an earlier upload", () => {
    expect(
      buildPromptReferenceBindingsForMode(seedanceLikeModel(), "multimodal_to_video", {
        referenceImages: [{ ...imageRow, label: "Image2" }],
      })[0].label
    ).toBe("Image2");
  });
});
