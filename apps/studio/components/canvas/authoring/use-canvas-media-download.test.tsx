// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { toast, type Action } from "sonner";
import { useCanvasMediaDownload } from "./use-canvas-media-download";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
let download: ReturnType<typeof useCanvasMediaDownload>;
let root: ReturnType<typeof createRoot> | undefined;
function Capture() {
  const handler = useCanvasMediaDownload();
  useLayoutEffect(() => {
    download = handler;
  }, [handler]);
  return null;
}
async function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(<Capture />);
  });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("offers deliberate recovery using the original authorized source without refetching", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await mount();
  const src = "/aurora/media/assets/fixture/content?documentId=fixture";
  await download(src, "Original name", "image");
  expect(toast.error).toHaveBeenCalledWith(
    "failed",
    expect.objectContaining({
      action: expect.objectContaining({ label: "openSource" }),
    })
  );
  const action = vi.mocked(toast.error).mock.calls[0][1]!.action as Action;
  open.mockReturnValue({} as Window);
  action.onClick({} as Parameters<Action["onClick"]>[0]);
  expect(open).toHaveBeenLastCalledWith(src, "_blank");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledTimes(1);
  open.mockReturnValue(null);
  action.onClick({} as Parameters<Action["onClick"]>[0]);
  expect(toast.error).toHaveBeenLastCalledWith("blocked");
});
it("does not show failure feedback when the fallback opens", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  vi.spyOn(window, "open").mockReturnValue({} as Window);
  await mount();
  await download("/media", "Work", "video");
  expect(toast.error).not.toHaveBeenCalled();
});
it("does not offer an empty source recovery action", async () => {
  await mount();
  await download("", "Work", "image");
  expect(toast.error).toHaveBeenCalledWith("failed", { action: undefined });
});
