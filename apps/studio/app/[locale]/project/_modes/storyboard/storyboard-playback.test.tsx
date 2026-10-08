import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryboardSequence } from "./storyboard-playback";
import type { ShotRow } from "./use-storyboard";
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    values ? `${key}:${Object.values(values).join("/")}` : key,
}));
vi.mock("@/components/canvas/authoring/canvas-document-context", () => ({
  useCanvasDocumentId: () => "document",
}));
vi.mock("@/components/media/use-media-playback-source", () => ({
  useMediaPlaybackSource: (src: string) => ({ src, refresh: async () => src, error: null }),
}));
vi.mock("@/components/media/use-video-poster", () => ({
  useVideoPoster: () => ({ data: undefined }),
}));
let root: Root, container: HTMLDivElement;
const rows = ["a", "b", "c"].map((id, i) => ({
  id,
  number: i + 1,
  order: id,
  data: {},
  pictures: [
    {
      edgeId: `edge-${id}`,
      sourceNodeId: id,
      kind: "video",
      status: "ready",
      generationModality: null,
      url: `https://assets.invalid/${id}.mp4`,
    },
  ],
})) as ShotRow[];
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(items = rows) {
  await act(async () => root.render(<StoryboardSequence rows={items} />));
}
async function click(label: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()
  );
}
async function mediaEvent(name: string) {
  await act(async () => container.querySelector("video")!.dispatchEvent(new Event(name)));
}
describe("Storyboard sequence playback", () => {
  it("uses real video controls and advances only when a clip ends", async () => {
    await render();
    expect(container.querySelector("video")!.controls).toBe(true);
    await mediaEvent("timeupdate");
    expect(container.querySelector("video")!.src).toContain("/a.mp4");
    await mediaEvent("ended");
    expect(container.querySelector("video")!.src).toContain("/b.mp4");
    expect(container.querySelector("video")!.autoplay).toBe(true);
  });
  it("keeps playback running through filmstrip selection and previous navigation", async () => {
    await render();
    await click("shot:3");
    expect(container.querySelector("video")!.src).toContain("/c.mp4");
    expect(container.querySelector("video")!.autoplay).toBe(true);
    await click("previous");
    expect(container.querySelector("video")!.src).toContain("/b.mp4");
  });
  it("stops at the final clip", async () => {
    await render();
    await click("shot:3");
    await mediaEvent("ended");
    expect(container.querySelector("video")!.src).toContain("/c.mp4");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="next"]')!.disabled).toBe(
      true
    );
  });
  it("keeps selection by identity during collaborative reorder", async () => {
    await render();
    await click("shot:2");
    await render([rows[1], rows[0], rows[2]]);
    expect(container.querySelector("video")!.src).toContain("/b.mp4");
    expect(container.querySelector('[aria-current="true"]')!.getAttribute("aria-label")).toBe(
      "shot:1"
    );
  });
  it("automatically skips empty shots without interrupting the rough cut", async () => {
    await render([rows[0], { ...rows[1], pictures: [] }, rows[2]]);
    await mediaEvent("ended");
    expect(container.querySelector("video")!.src).toContain("/c.mp4");
  });
  it("skips leading and trailing placeholders and handles an entirely empty cut", async () => {
    await render([{ ...rows[0], pictures: [] }, rows[1], { ...rows[2], pictures: [] }]);
    expect(container.querySelector("video")!.src).toContain("/b.mp4");
    await mediaEvent("ended");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="next"]')!.disabled).toBe(
      true
    );
    await render(rows.map((row) => ({ ...row, pictures: [] })));
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toBe("missing");
  });
  it("retries a failed clip", async () => {
    await render();
    await mediaEvent("error");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("error");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click()
    );
    expect(container.querySelector("video")!.src).toContain("/a.mp4");
  });
  it("handles deleted selection and an empty storyboard", async () => {
    await render();
    await click("shot:2");
    await render([rows[2]]);
    expect(container.querySelector("video")!.src).toContain("/c.mp4");
    await render([]);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="next"]')!.disabled).toBe(
      true
    );
  });
});

it("plays the preferred still for five seconds, pauses, then advances to video", async () => {
  vi.useFakeTimers();
  const image = {
    ...rows[0],
    preferredFrameEdgeId: "preferred",
    pictures: [
      { ...rows[0].pictures[0], kind: "image", url: "https://assets.invalid/first.png" },
      {
        ...rows[0].pictures[0],
        kind: "image",
        edgeId: "preferred",
        url: "https://assets.invalid/preferred.png",
      },
    ],
  } as ShotRow;
  await render([image, rows[1]]);
  const img = container.querySelector<HTMLImageElement>('img[alt="image"]')!;
  expect(img.src).toContain("preferred.png");
  await act(async () => img.dispatchEvent(new Event("load")));
  const control = () =>
    [...container.querySelectorAll("button")].find((b) =>
      ["play", "pause"].includes(b.textContent ?? "")
    )!;
  expect(control().textContent).toBe("pause");
  await act(async () => vi.advanceTimersByTime(2000));
  await act(async () => control().click());
  await act(async () => vi.advanceTimersByTime(6000));
  expect(container.querySelector("video")).toBeNull();
  await act(async () => control().click());
  await act(async () => vi.advanceTimersByTime(3000));
  expect(container.querySelector("video")?.src).toContain("b.mp4");
});
