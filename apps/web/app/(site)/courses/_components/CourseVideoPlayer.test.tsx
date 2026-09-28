import { recomputePublicCourseProgress } from "@/src/hooks/use-courses-public";
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
  const node = document.createElement("div"),
    root = createRoot(node);
  try {
    await act(async () =>
      root.render(<CourseVideoPlayer courseId={0} title="Test" videoUrl="/test.mp4" />)
    );
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
  } finally {
    act(() => root.unmount());
  }
});

it("ignores seeks before duration is known and clamps skips to the media duration", async () => {
  const node = document.createElement("div"),
    root = createRoot(node);
  try {
    await act(async () =>
      root.render(<CourseVideoPlayer courseId={1} title="Test" videoUrl="/test.mp4" />)
    );
    const video = node.querySelector("video")!;
    const setTime = vi.fn();
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 95,
      set: setTime,
    });
    const forward = node.querySelector<HTMLButtonElement>('button[aria-label="Skip forward"]')!;
    await act(async () => forward.click());
    expect(setTime).not.toHaveBeenCalled();
    Object.defineProperty(video, "duration", { configurable: true, value: 100 });
    await act(async () => forward.click());
    expect(setTime).toHaveBeenLastCalledWith(100);
  } finally {
    act(() => root.unmount());
  }
});

it("clears replacement lesson time while flushing each originating series", async () => {
  const node = document.createElement("div"),
    root = createRoot(node);
  vi.mocked(recomputePublicCourseProgress).mockClear();
  try {
    await act(async () =>
      root.render(
        <CourseVideoPlayer
          courseId={1}
          seriesCourseId={10}
          seriesVideoIds={[1]}
          title="Old"
          videoUrl="/same.mp4"
        />
      )
    );
    const old = node.querySelector("video")!;
    Object.defineProperty(old, "duration", { value: 100 });
    await act(async () => old.dispatchEvent(new Event("loadedmetadata")));
    await act(async () => {
      old.currentTime = 50;
      old.dispatchEvent(new Event("timeupdate"));
    });
    expect(node.textContent).toContain("0:50");
    await act(async () =>
      root.render(
        <CourseVideoPlayer
          courseId={2}
          seriesCourseId={20}
          seriesVideoIds={[2]}
          title="New"
          videoUrl="/same.mp4"
        />
      )
    );
    expect(node.querySelector("video")).not.toBe(old);
    expect(node.textContent).not.toContain("0:50");
    expect(vi.mocked(recomputePublicCourseProgress)).toHaveBeenCalledWith(10, [1]);
  } finally {
    act(() => root.unmount());
  }
  expect(vi.mocked(recomputePublicCourseProgress)).toHaveBeenLastCalledWith(20, [2]);
});
