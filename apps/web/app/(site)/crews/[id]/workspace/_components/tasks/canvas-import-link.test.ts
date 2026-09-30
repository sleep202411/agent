import { expect, it } from "vitest";
import { canvasImportProjectId } from "./canvas-import-link";
const id = "01990000-0000-7000-8000-000000000001";
const origin = "https://studio.fizzdragon.com";
it("extracts project identity from localized chapter links", () => {
  expect(
    canvasImportProjectId(`${origin}/zh-CN/story-studio/projects/${id}/canvas?chapter=one`, origin)
  ).toBe(id);
});
it.each([
  `https://evil.example/story-studio/projects/${id}/canvas`,
  `https://studio.fizzdragon.com.evil.example/story-studio/projects/${id}/canvas`,
  `${origin.replace("https://", "https://user@")}/story-studio/projects/${id}/canvas`,
  `${origin}/story-studio/projects/${id}/playtest`,
  `${origin}/story-studio/projects/invalid/canvas`,
  `javascript:alert(1)`,
])("rejects unsupported links: %s", (url) => expect(canvasImportProjectId(url, origin)).toBeNull());
