import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { IpHoverPreview } from "./ip-hover-preview";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([false, true])(
  "plays only on activation and respects reduced motion (%s)",
  async (reduced) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("matchMedia", () => ({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const host = document.createElement("div"),
      root = createRoot(host);
    try {
      await act(async () =>
        root.render(<IpHoverPreview src="https://preview.test/trailer.mp4" active={false} />)
      );
      expect(host.querySelector("video")).toBeNull();
      expect(play).not.toHaveBeenCalled();
      await act(async () =>
        root.render(<IpHoverPreview src="https://preview.test/trailer.mp4" active />)
      );
      expect(play).toHaveBeenCalledTimes(reduced ? 0 : 1);
      const video = host.querySelector("video")!;
      expect(video.muted).toBe(true);
      expect(video.className).toContain("opacity-0");
      if (!reduced) {
        await act(async () => video.dispatchEvent(new Event("playing")));
        expect(video.className).toContain("opacity-100");
        await act(async () => video.dispatchEvent(new Event("error")));
        expect(video.className).toContain("opacity-0");
      }
      await act(async () =>
        root.render(<IpHoverPreview src="https://preview.test/trailer.mp4" active={false} />)
      );
      expect(host.querySelector("video")).toBeNull();
      expect(pause).toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  }
);
