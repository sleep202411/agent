import { expect, it } from "vitest";
import {
  panoramaDocument,
  readPanoramaEvent,
  type PanoramaLabels,
} from "./story-panorama-document";
const labels = Object.fromEntries(
  ["title", "hint", "left", "right", "up", "down", "zoomIn", "zoomOut", "reset"].map((key) => [
    key,
    '<script>" &',
  ])
) as PanoramaLabels;
it("keeps the renderer offline and escapes all localized content", () => {
  const html = panoramaDocument("session", "data:image/png;base64,AQ==", labels);
  expect(html).toContain("default-src 'none'; img-src data:");
  expect(html).not.toContain('<script>" &');
  expect(html).toContain("&lt;script>&quot; &amp;");
  expect(() => panoramaDocument("session", "https://example.test/image", labels)).toThrow("bytes");
});
it("accepts only events for the active renderer session", () => {
  expect(
    readPanoramaEvent(JSON.stringify({ sessionId: "a", type: "loaded", detail: "2048×1024" }), "a")
  ).toMatchObject({ type: "loaded" });
  for (const raw of [
    null,
    "bad",
    JSON.stringify({ sessionId: "b", type: "loaded" }),
    JSON.stringify({ sessionId: "a", type: "navigate" }),
    JSON.stringify({ sessionId: "a", type: "loaded", detail: {} }),
  ])
    expect(readPanoramaEvent(raw, "a")).toBeNull();
});
