import { recomputePublicCourseProgress } from "@/src/hooks/use-courses-public";
// @vitest-environment jsdom
import { act } from "react";
import { toast } from "sonner";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CourseVideoPlayer } from "./CourseVideoPlayer";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
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

it("reports rejected playback and fullscreen requests without unhandled rejections", async () => {
  const node = document.createElement("div"),
    root = createRoot(node);
  vi.mocked(toast.error).mockClear();
  try {
    await act(async () =>
      root.render(<CourseVideoPlayer courseId={1} title="Test" videoUrl="/test.mp4" />)
    );
    const video = node.querySelector("video")!;
    video.play = vi.fn().mockRejectedValue(new Error("Playback denied"));
    await act(async () =>
      node.querySelector<HTMLButtonElement>('button[aria-label="Play or pause"]')!.click()
    );
    expect(toast.error).toHaveBeenLastCalledWith("Playback denied");
    const section = node.querySelector("section")!;
    section.requestFullscreen = vi.fn().mockRejectedValue(new Error("Fullscreen denied"));
    await act(async () =>
      node.querySelector<HTMLButtonElement>('button[aria-label="Fullscreen"]')!.click()
    );
    expect(toast.error).toHaveBeenLastCalledWith("Fullscreen denied");
  } finally {
    act(() => root.unmount());
  }
});

it("reports unsupported fullscreen through the existing notification system", async () => {
  const node = document.createElement("div"),
    root = createRoot(node);
  vi.mocked(toast.error).mockClear();
  try {
    await act(async () =>
      root.render(<CourseVideoPlayer courseId={1} title="Test" videoUrl="/test.mp4" />)
    );
    await act(async () =>
      node.querySelector<HTMLButtonElement>('button[aria-label="Fullscreen"]')!.click()
    );
    expect(toast.error).toHaveBeenLastCalledWith("fullscreenUnavailable");
  } finally {
    act(() => root.unmount());
  }
});

it("ignores playback failures from a lesson replaced while play was pending", async () => {
  const node = document.createElement("div"),
    root = createRoot(node);
  vi.mocked(toast.error).mockClear();
  let reject!: (error: Error) => void;
  try {
    await act(async () =>
      root.render(<CourseVideoPlayer courseId={1} title="Old" videoUrl="/old.mp4" />)
    );
    node.querySelector("video")!.play = vi.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        })
    );
    await act(async () =>
      node.querySelector<HTMLButtonElement>('button[aria-label="Play or pause"]')!.click()
    );
    await act(async () =>
      root.render(<CourseVideoPlayer courseId={2} title="New" videoUrl="/new.mp4" />)
    );
    await act(async () => reject(new Error("Obsolete failure")));
    expect(toast.error).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});
