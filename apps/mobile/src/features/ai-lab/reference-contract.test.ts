import { expect, it } from "vitest";
import {
  buildReferenceContract,
  identifiedImages,
  imageReferences,
  nextImageLabel,
  replaceImageUrl,
  objectImageField,
  referenceInputValues,
} from "./reference-contract";
import { fieldDescriptors, serializeFieldValue } from "./schema";
import { prepareFormValues } from "./form-values";
import type { AiObjectSchema } from "@repo/shared";
const schema: AiObjectSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    referenceImages: {
      type: "array",
      "x-ui": { control: "image_upload" },
      maxItems: 2,
      items: {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string", format: "uri" } },
        additionalProperties: true,
      },
    },
  },
};
it("recognizes official object-array image fields and preserves JSON fallback data", () => {
  const field = fieldDescriptors(schema, {}).find((x) => x.name === "referenceImages")!;
  expect(objectImageField(field)).toBe(true);
  const rows = [{ url: "https://cdn.test/a", assetId: "asset", refId: "a", label: "Image1" }];
  expect(imageReferences(serializeFieldValue(field.field, rows))).toEqual(rows);
  expect(prepareFormValues(schema, { referenceImages: rows }).referenceImages).toEqual(rows);
  expect(() => prepareFormValues(schema, { referenceImages: [{ url: "" }] })).toThrow();
  expect(() => imageReferences("broken json")).toThrow();
});
it("keeps exact prompt text and reference identities through ordering and repeated mentions", () => {
  const rows = identifiedImages([
    { url: "https://cdn.test/a", assetId: "a" },
    { url: "https://cdn.test/b", assetId: "b" },
  ]);
  const contract = buildReferenceContract({
    referenceImages: rows.reverse(),
    prompt: "Use @Image1, then @Image2 and @Image1.\nKeep it soft.",
  });
  expect(contract.referenceBindings.map((r) => [r.refId, r.label, r.order])).toEqual([
    ["b", "Image2", 1],
    ["a", "Image1", 2],
  ]);
  expect(contract.promptDocument.nodes).toEqual([
    { type: "text", text: "Use " },
    { type: "asset_ref", refId: "a", label: "Image1" },
    { type: "text", text: ", then " },
    { type: "asset_ref", refId: "b", label: "Image2" },
    { type: "text", text: " and " },
    { type: "asset_ref", refId: "a", label: "Image1" },
    { type: "text", text: ".\nKeep it soft." },
  ]);
});
it("does not accidentally bind prefix matches, emails or removed image aliases", () => {
  const referenceImages = [
    { url: "https://cdn.test/a", refId: "a", label: "Image1" },
    { url: "https://cdn.test/b", refId: "b", label: "Image10" },
  ];
  const result = buildReferenceContract({
    referenceImages,
    prompt: "@Image10 user@Image1.test @Image1extra",
  });
  expect(result.promptDocument.nodes).toEqual([
    { type: "asset_ref", refId: "b", label: "Image10" },
    { type: "text", text: " user@Image1.test @Image1extra" },
  ]);
  expect(() => buildReferenceContract({ referenceImages: [], prompt: "Use @Image1" })).toThrow(
    "missing"
  );
  expect(nextImageLabel([], "Use @Image1")).toBe("Image2");
  expect(() =>
    buildReferenceContract({
      referenceImages: [...referenceImages, referenceImages[0]],
      prompt: "",
    })
  ).toThrow("unique");
});
it("replacing a file URL removes its prior trusted identity but preserves the mention", () => {
  expect(
    replaceImageUrl(
      {
        url: "https://cdn.test/a",
        assetId: "a",
        refId: "r",
        label: "Image1",
        bytes: 100,
        durationSeconds: 2,
      },
      "https://cdn.test/b"
    )
  ).toEqual({ url: "https://cdn.test/b", refId: "r", label: "Image1" });
});

it("recognizes mentions adjacent to Chinese prose", () => {
  expect(
    buildReferenceContract({
      referenceImages: [{ url: "https://cdn.test/a", refId: "a", label: "Image1" }],
      prompt: "使用@Image1的颜色",
    }).promptDocument.nodes
  ).toEqual([
    { type: "text", text: "使用" },
    { type: "asset_ref", refId: "a", label: "Image1" },
    { type: "text", text: "的颜色" },
  ]);
});

it("keeps binding metadata out of strict provider input schemas", () => {
  const strict: AiObjectSchema = {
    type: "object",
    properties: {
      referenceImages: {
        type: "array",
        "x-ui": { control: "image_upload" },
        items: {
          type: "object",
          properties: { url: { type: "string", format: "uri" } },
          required: ["url"],
          additionalProperties: false,
        },
      },
    },
  };
  const raw = {
    referenceImages: [{ url: "https://cdn.test/a", assetId: "asset", refId: "r", label: "Image1" }],
  };
  expect(
    prepareFormValues(strict, referenceInputValues(fieldDescriptors(strict, raw), raw))
  ).toEqual({ referenceImages: [{ url: "https://cdn.test/a" }] });
  expect(buildReferenceContract(raw).referenceBindings[0].assetId).toBe("asset");
});
it("rejects duplicate underlying images before server deduplication can lose mentions", () => {
  expect(() =>
    buildReferenceContract({
      referenceImages: [
        { url: "https://cdn.test/a", refId: "a", label: "Image1" },
        { url: "https://cdn.test/a", refId: "b", label: "Image2" },
      ],
      prompt: "@Image2",
    })
  ).toThrow("unique");
});

it("binds image and video mentions with globally ordered stable identities", () => {
  const result = buildReferenceContract({
    referenceImages: [{ url: "https://cdn.test/i", assetId: "image" }],
    referenceVideos: [
      { url: "https://cdn.test/v", refId: "video", label: "Video2", durationSeconds: 2.125 },
    ],
    prompt: "@Image1参考@Video2",
  });
  expect(result.referenceBindings.map((r) => [r.refId, r.kind, r.order])).toEqual([
    ["image", "image", 1],
    ["video", "video", 2],
  ]);
  expect(result.promptDocument.nodes).toContainEqual({
    type: "asset_ref",
    refId: "video",
    label: "Video2",
  });
  expect(() => buildReferenceContract({ referenceVideos: [], prompt: "Use @Video2" })).toThrow(
    "missing"
  );
});

it("keeps mixed image, video and audio aliases ordered and rejects removed audio mentions", () => {
  const input = {
    prompt: "@Image1 @Video1 @Audio1",
    referenceImages: [{ url: "https://cdn.test/i" }],
    referenceVideos: [{ url: "https://cdn.test/v" }],
    referenceAudios: [{ url: "https://cdn.test/a" }],
  };
  const result = buildReferenceContract(input);
  expect(result.referenceBindings.map((r) => [r.kind, r.label, r.order])).toEqual([
    ["image", "Image1", 1],
    ["video", "Video1", 2],
    ["audio", "Audio1", 3],
  ]);
  expect(() => buildReferenceContract({ ...input, referenceAudios: [] })).toThrow("Audio1");
});
