import { expect, it, vi } from "vitest";
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
