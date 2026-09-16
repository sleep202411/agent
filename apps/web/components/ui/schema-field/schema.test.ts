import { expect, it } from "vitest";
import { normalizeAiModel } from "./schema";
import { AI_MODEL_PATHS } from "./paths";
it.each([
  [AI_MODEL_PATHS.music, "music"],
  [AI_MODEL_PATHS.lipSync, "lipsync"],
  [AI_MODEL_PATHS.voice, "audio"],
  [AI_MODEL_PATHS.video, "video"],
  [AI_MODEL_PATHS.image, "image"],
])("classifies the actual %s endpoint as %s", (path, type) => {
  expect(normalizeAiModel({ serviceCode: "fixture", path }).type).toBe(type);
});
it("removes nonfinite and duplicate duration options without changing finite sentinel values", () => {
  const model = normalizeAiModel({
    description: JSON.stringify({
      videoLength: ["Infinity", "-Infinity", "NaN", 5, "5", 10, -1, 0],
    }),
  });
  expect(model.inputSchema.properties.videoLength.enum).toEqual([5, 10, -1, 0]);
  expect(model.inputSchema.properties.videoLength.default).toBe(5);
});
