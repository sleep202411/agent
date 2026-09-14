// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CourseVideoPlayer } from "./CourseVideoPlayer";
vi.mock("@/src/hooks/use-courses", () => ({
  readLatestStoredEpisodeProgress: () => null,
  writeStoredEpisodeProgress: vi.fn(),
}));
vi.mock("@/src/hooks/use-courses-public", () => ({ recomputePublicCourseProgress: vi.fn() }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("reflects external media volume changes and restores sound from zero volume", async () => {
  const node = document.createElement("div"), root = createRoot(node);
  try {
    await act(async () => root.render(<CourseVideoPlayer courseId={0} title="Test" videoUrl="/test.mp4" />));
    const video = node.querySelector("video")!;
    await act(async () => {
      video.volume = 0;
      video.dispatchEvent(new Event("volumechange"));
    });
    const unmute = node.querySelector<HTMLButtonElement>('button[aria-label="unmute"]')!;
    expect(unmute.getAttribute("aria-pressed")).toBe("true");
    await act(async () => unmute.click());
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);
    expect(node.querySelector('button[aria-label="mute"]')).not.toBeNull();
    await act(async () => {
      video.muted = true;
      video.dispatchEvent(new Event("volumechange"));
    });
    expect(node.querySelector('button[aria-label="unmute"]')).not.toBeNull();
  } finally { act(() => root.unmount()); }
});
