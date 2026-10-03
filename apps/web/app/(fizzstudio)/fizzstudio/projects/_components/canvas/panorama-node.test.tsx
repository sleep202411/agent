import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NodeProps } from "@xyflow/react";

const state = vi.hoisted(() => ({ load: vi.fn(), download: vi.fn() }));
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/src/lib/media-download", () => ({
  downloadMediaFile: state.download,
  inferDownloadFilename: () => "panorama.png",
}));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
    },
    TextureLoader: class {
      setCrossOrigin() {}
      load(...args: unknown[]) {
        state.load(...args);
      }
    },
  };
});
vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    update() {}
    dispose() {}
  },
}));
import { PanoramaNode, type PanoramaNodeData } from "./panorama-node";
import { MOCK_PANORAMA_IMAGE_URL } from "./canvas-constants";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  state.load.mockReset();
  state.download.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function render(patch: Partial<PanoramaNodeData> = {}) {
  const data = {
    node: { id: "panorama", kind: "panorama", media: [], status: "idle" },
    composerVisible: false,
    relation: "neutral",
    ...patch,
  };
  act(() => root.render(<PanoramaNode {...({ data, selected: false } as unknown as NodeProps)} />));
}
it("starts empty without presenting a generated result or fabricated dimensions", () => {
  render();
  expect(host.textContent).toContain("sbPanoramaEmpty");
  expect(host.textContent).not.toContain("2048 x 1024");
  expect(host.querySelector('[aria-label="sbNodeDownload"]')).toBeNull();
  expect(
    (host.querySelector('[aria-label="sbPanoramaOpenViewer"]') as HTMLButtonElement).disabled
  ).toBe(true);
  expect(state.load).not.toHaveBeenCalled();
});
it("does not present persisted bundled demo media as a user result", () => {
  render({
    node: {
      id: "panorama",
      kind: "panorama",
      status: "done",
      media: [{ id: "demo", url: MOCK_PANORAMA_IMAGE_URL, status: "done", preferred: true }],
    },
  });
  expect(host.textContent).toContain("sbPanoramaEmpty");
  expect(host.querySelector('[aria-label="sbNodeDownload"]')).toBeNull();
  expect(state.load).not.toHaveBeenCalled();
});
it("labels a reference preview and does not expose it as generated output", () => {
  render({
    referenceMedia: {
      id: "reference",
      url: "https://media.test/reference.png",
      width: 1200,
      height: 600,
    },
  });
  expect(host.textContent).toContain("sbPanoramaReferencePreview");
  expect(host.textContent).toContain("1200 x 600");
  expect(host.querySelector('[aria-label="sbNodeDownload"]')).toBeNull();
  expect(state.load.mock.calls[0]?.[0]).toBe("https://media.test/reference.png");
});
it("preserves real results and retries texture failure without fake fallback media", () => {
  render({
    node: {
      id: "panorama",
      kind: "panorama",
      status: "done",
      media: [
        {
          id: "real",
          url: "https://media.test/result.png",
          width: 4096,
          height: 2048,
          status: "done",
        },
      ],
    },
  });
  expect(host.textContent).toContain("4096 x 2048");
  expect(host.querySelector('[aria-label="sbNodeDownload"]')).not.toBeNull();
  act(() => state.load.mock.calls[0]![3]());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("sbPanoramaLoadFailed");
  act(() => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  expect(state.load).toHaveBeenCalledTimes(2);
  expect(state.load.mock.calls[1]?.[0]).toBe("https://media.test/result.png");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("ignores errors from a preview that is no longer selected", () => {
  render({ referenceMedia: { id: "old", url: "https://media.test/old.png" } });
  const oldFailure = state.load.mock.calls[0]![3];
  render({ referenceMedia: { id: "new", url: "https://media.test/new.png" } });
  act(() => oldFailure());
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
