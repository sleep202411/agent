import { afterEach, expect, it, vi } from "vitest";
import { appEnv } from "@/config";
import type { AiObjectSchema } from "@repo/shared";
import { canvasSeedDraft, readCanvasGenerationSeed } from "./canvas-seed";
const snapshot = (data: unknown, type = "prompt") => ({
  meta: {},
  edges: {},
  groups: {},
  assets: {},
  nodes: { card: { id: "card", type, data } },
});
const schema: AiObjectSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    seed: { type: "number", default: 1 },
    referenceImages: {
      type: "array",
      items: { type: "object", properties: { url: { type: "string" } } },
    },
    referenceVideos: { type: "array", items: { type: "string" } },
  },
};
it("seeds card content, stable reference identities and metadata without mutating the snapshot", () => {
  const source = snapshot({
    modelId: "model",
    prompt: "Use @Image3",
    settings: { seed: 42 },
    references: {
      referenceImages: [
        { id: "image", url: "https://example.com/a.png", label: "Image3", kind: "image" },
      ],
      referenceVideos: [
        {
          id: "video",
          url: "https://example.com/v.mp4",
          durationSeconds: 4,
          bytes: 100,
          kind: "video",
        },
      ],
    },
  });
  const before = JSON.stringify(source);
  const { seed, mode } = readCanvasGenerationSeed(source, "card");
  const draft = canvasSeedDraft(seed, "model", schema);
  expect(mode).toBe("image");
  expect(draft.values).toMatchObject({
    prompt: "Use @Image3",
    seed: 42,
    referenceImages: [{ refId: "image", label: "Image3" }],
    referenceVideos: "https://example.com/v.mp4",
  });
  expect(draft.referenceMedia[1]).toMatchObject({
    field: "referenceVideos",
    kind: "video",
    durationSeconds: 4,
    bytes: 100,
  });
  expect(canvasSeedDraft(seed, "different", schema).values.seed).toBe(1);
  expect(JSON.stringify(source)).toBe(before);
});
it("rejects locked/non-generation cards, unfinished uploads and unsupported references", () => {
  expect(() => readCanvasGenerationSeed(snapshot({ locked: true }), "card")).toThrow("locked");
  expect(() => readCanvasGenerationSeed(snapshot({}, "note"), "card")).toThrow();
  const row = { id: "ref", url: "https://example.com/ref.png" };
  const seed = readCanvasGenerationSeed(snapshot({ references: { missing: [row] } }), "card").seed;
  expect(() => canvasSeedDraft(seed, "model", schema)).toThrow("does not accept");
  seed.references = { referenceImages: [{ ...row, uploading: true }] };
  expect(() => canvasSeedDraft(seed, "model", schema)).toThrow("uploading");
});
it("keeps frame references positional without shifting mention labels", () => {
  const seed = readCanvasGenerationSeed(
    snapshot({
      references: {
        startFrame: [{ id: "frame", url: "https://example.com/frame.png" }],
        referenceImages: [{ id: "ref", url: "https://example.com/ref.png" }],
      },
    }),
    "card"
  ).seed;
  const result = canvasSeedDraft(seed, "model", {
    ...schema,
    properties: { startFrame: { type: "string" }, ...schema.properties },
  });
  expect(result.values.startFrame).toBe("https://example.com/frame.png");
  expect(result.values.referenceImages).toMatchObject([{ label: "Image1" }]);
});

vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));

it.each(["blob:old-preview", "file:///cache/image.png", "/old/preview", ""])(
  "recovers asset-backed %s previews without changing the saved canvas",
  (url) => {
    const source = snapshot({
      references: {
        referenceImages: [{ id: "ref", url, assetId: "asset/id", kind: "image" }],
      },
    });
    const before = JSON.stringify(source);
    const result = canvasSeedDraft(readCanvasGenerationSeed(source, "card").seed, "model", schema);
    expect(result.values.referenceImages).toMatchObject([
      {
        url: "https://fizzdragon.com/aurora/media/assets/asset%2Fid/content",
        assetId: "asset/id",
        refId: "ref",
      },
    ]);
    expect(result.referenceMedia[0]?.url).toBe(
      "https://fizzdragon.com/aurora/media/assets/asset%2Fid/content"
    );
    expect(JSON.stringify(source)).toBe(before);
  }
);
it.each(["blob:old", "file:///cache/a", "/preview", "", "data:image/png;base64,abc"])(
  "rejects unavailable %s references without a durable asset",
  (url) => {
    const seed = readCanvasGenerationSeed(
      snapshot({
        references: {
          referenceImages: [{ id: "ref", url }],
        },
      }),
      "card"
    ).seed;
    expect(() => canvasSeedDraft(seed, "model", schema)).toThrow("unavailable");
  }
);

vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));

const originalBase = appEnv.api.auroraBaseUrl;
afterEach(() => {
  appEnv.api.auroraBaseUrl = originalBase;
});
it("uses the configured CN Aurora host for recovered frame and list references", () => {
  appEnv.api.auroraBaseUrl = "https://fizzstudio.fizzspace.cn/aurora/";
  const seed = readCanvasGenerationSeed(
    snapshot({
      references: {
        startFrame: [{ id: "frame", url: "blob:gone", assetId: "frame" }],
        referenceVideos: [{ id: "video", url: "", assetId: "video" }],
      },
    }),
    "card"
  ).seed;
  const result = canvasSeedDraft(seed, "model", {
    ...schema,
    properties: {
      ...schema.properties,
      startFrame: { type: "string" },
    },
  });
  expect(result.values.startFrame).toBe(
    "https://fizzstudio.fizzspace.cn/aurora/media/assets/frame/content"
  );
  expect(result.values.referenceVideos).toBe(
    "https://fizzstudio.fizzspace.cn/aurora/media/assets/video/content"
  );
});

it("defers inactive references intact until their mode becomes active", () => {
  const seed = readCanvasGenerationSeed(
    snapshot({
      mode: "text_to_image",
      references: {
        referenceImages: [{ id: "pending", url: "blob:pending", uploading: true }],
      },
    }),
    "card"
  ).seed;
  const draft = canvasSeedDraft(seed, "model", schema, []);
  expect(seed.mode).toBe("text_to_image");
  expect(draft.deferredCanvasReferences).toEqual(seed.references);
  expect(draft.referenceMedia).toEqual([]);
  expect(() =>
    canvasSeedDraft({ ...seed, references: draft.deferredCanvasReferences! }, "model", schema, [
      "referenceImages",
    ])
  ).toThrow("uploading");
});
