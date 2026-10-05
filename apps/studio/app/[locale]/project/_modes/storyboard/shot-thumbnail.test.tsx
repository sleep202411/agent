import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ShotThumbnail } from "./shot-thumbnail";
import type { ShotRow } from "./use-storyboard";
const poster = vi.hoisted(() => vi.fn());
vi.mock("@/components/media/use-video-poster", () => ({ useVideoPoster: poster }));
vi.mock("@/components/canvas/authoring/canvas-document-context", () => ({
  useCanvasDocumentId: () => "doc",
}));
let root: Root, host: HTMLDivElement, notify: IntersectionObserverCallback;
const row = {
  id: "shot",
  pictures: [
    { edgeId: "video", kind: "video", status: "ready", url: "https://assets.invalid/clip.mp4" },
    { edgeId: "image", kind: "image", status: "ready", url: "https://assets.invalid/other.png" },
  ],
} as ShotRow;
beforeEach(() => {
  poster.mockReset();
  poster.mockReturnValue({ data: { status: "ready", url: "https://assets.invalid/poster.jpg" } });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    }
  );
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("defers poster work until visible and uses the video poster rather than an unrelated still", async () => {
  await act(async () => root.render(<ShotThumbnail row={row} />));
  expect(poster).toHaveBeenLastCalledWith(
    "https://assets.invalid/clip.mp4",
    undefined,
    "doc",
    false
  );
  await act(async () =>
    notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  );
  expect(poster).toHaveBeenLastCalledWith(
    "https://assets.invalid/clip.mp4",
    undefined,
    "doc",
    true
  );
  expect(host.querySelector("img")!.src).toContain("poster.jpg");
});
it("falls back cleanly when a poster cannot be loaded", async () => {
  await act(async () => root.render(<ShotThumbnail row={row} />));
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("svg")).not.toBeNull();
});
