// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GenerationOutputGallery } from "./generation-output-gallery";
import en from "../../../messages/en-US.json";
import cn from "../../../messages/zh-CN.json";
import hk from "../../../messages/zh-HK.json";

const download = vi.hoisted(() => vi.fn());
vi.mock("./use-canvas-media-download", () => ({ useCanvasMediaDownload: () => download }));
vi.mock("@/components/media/canvas-video", () => ({ CanvasVideo: () => null }));
const outputs = [1, 2].map((n) => ({
  type: "image" as const,
  url: `https://example.com/${n}.png`,
  assetId: `asset-${n}`,
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  download.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it.each([
  ["en-US", en],
  ["zh-CN", cn],
  ["zh-HK", hk],
] as const)("%s opens and downloads the second returned image", async (locale, messages) => {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <GenerationOutputGallery outputs={outputs} title="Scene" />
      </NextIntlClientProvider>
    )
  );
  expect(host.querySelectorAll("button")).toHaveLength(2);
  await act(async () => host.querySelectorAll("button")[1].click());
  const viewerImage = document.body.querySelector('img[alt]:not([alt=""])');
  expect(viewerImage?.getAttribute("src")).toBe(outputs[1].url);
  expect(document.body.textContent).toContain("Scene · 2/2");
  const downloadButton = document.body.querySelector<HTMLButtonElement>(
    `button[aria-label="${messages.generation.download}"]`
  )!;
  await act(async () => downloadButton.click());
  expect(download).toHaveBeenCalledWith(outputs[1].url, "Scene-2.png", "image");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(document.body.querySelector('img[alt]:not([alt=""])')).toBeNull();
});

it("does not retain an old image viewer when results are replaced and hides single-output galleries", async () => {
  const render = async (results: typeof outputs) =>
    act(async () =>
      root.render(
        <NextIntlClientProvider locale="en-US" messages={en}>
          <GenerationOutputGallery outputs={results} title="Scene" />
        </NextIntlClientProvider>
      )
    );
  await render(outputs);
  await act(async () => host.querySelectorAll("button")[1].click());
  await render(outputs.map((o) => ({ ...o, url: `${o.url}?new` })));
  expect(document.body.querySelector('img[alt]:not([alt=""])')).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
  await render(outputs.slice(0, 1));
  expect(host.querySelector("button")).toBeNull();
});
