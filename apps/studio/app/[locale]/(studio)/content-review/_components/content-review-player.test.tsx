// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { it, vi, expect } from "vitest";
import { ContentReviewPlayer } from "./content-review-player";
const s = vi.hoisted(() => ({ src: null as string | null }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/media/use-media-playback-source", () => ({
  useMediaPlaybackSource: () => ({ src: s.src, error: null }),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each([12, 24, null])(
  "applies the latest pending selection after metadata (seconds=%s)",
  async (seconds) => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const host = document.createElement("div");
    const root = createRoot(host);
    const onTime = vi.fn();
    const props = {
      src: "unused",
      mediaAssetId: "asset",
      findings: [
        {
          id: "f",
          seconds: 12,
          source: "frame" as const,
          label: "Finding",
          description: "",
          confidence: null,
          frameUrl: null,
          audioText: null,
          createdByUserId: null,
        },
      ],
      selectedId: "f",
      onSelect: vi.fn(),
      onDuration: vi.fn(),
      onTime,
      onRemove: vi.fn(),
      canRemove: true,
    };
    try {
      s.src = null;
      await act(async () => root.render(createElement(ContentReviewPlayer, props)));
      expect(host.querySelector("video")).toBeNull();
      if (seconds != null) props.findings[0]!.seconds = seconds;
      props.selectedId = seconds == null ? "" : "f";
      await act(async () => root.render(createElement(ContentReviewPlayer, props)));
      s.src = "https://fixture.invalid/video.mp4";
      await act(async () => root.render(createElement(ContentReviewPlayer, props)));
      const video = host.querySelector("video")!;
      Object.defineProperty(video, "duration", { value: 30 });
      await act(async () => video.dispatchEvent(new Event("loadedmetadata")));
      expect(video.currentTime).toBe(seconds ?? 0);
      if (seconds != null) expect(onTime).toHaveBeenCalledWith(seconds);
      else expect(onTime).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      pause.mockRestore();
      s.src = null;
    }
  }
);
