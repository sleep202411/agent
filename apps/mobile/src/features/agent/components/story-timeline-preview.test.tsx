import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { TimelinePreview } from "./story-timeline-preview";
import { timelinePlaybackClips, timelineClipAt } from "../api/story-timeline-playback";
import type { TimelineSequence } from "../api/story-timeline-api";
const h = vi.hoisted(() => ({
  active: true,
  player: { currentTime: 0, status: "readyToPlay", play: vi.fn(), seekBy: vi.fn(), pause: vi.fn() },
}));
vi.mock("expo", () => ({ useEvent: () => ({ status: h.player.status }) }));
vi.mock("expo-video", () => ({
  useVideoPlayer: () => h.player,
  VideoView: () => <span>video</span>,
}));
vi.mock("expo-image", () => ({ Image: () => <span>image</span> }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({ value, onChangeText }: { value: string; onChangeText: (s: string) => void }) => (
    <input value={value} onChange={(e) => onChangeText(e.target.value)} />
  ),
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
const sequence = {
  id: "sequence",
  version: 1,
  durationMs: 2000,
  clips: [
    {
      id: "one",
      title: "First",
      kind: "image",
      rank: 0,
      startMs: 0,
      durationMs: 1000,
      selectedMediaVersion: {
        mediaKind: "image",
        previewUrl: "https://example.com/image.png",
        thumbnailUrl: null,
      },
    },
    {
      id: "two",
      title: "Second",
      kind: "video",
      rank: 1,
      startMs: 1000,
      durationMs: 1000,
      selectedMediaVersion: { mediaKind: "video", previewUrl: "https://example.com/video.mp4" },
    },
  ],
} as unknown as TimelineSequence;
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = async (value = sequence) => {
  await act(async () => root.render(<TimelinePreview sequence={value} />));
};
const click = async (name: string) => {
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === name)!.click()
  );
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.active = true;
  h.player.status = "readyToPlay";
  h.player.currentTime = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("starts paused, plays across image/video boundaries, stops at end and replays", async () => {
  await render();
  expect(host.textContent).toContain("image");
  expect(h.player.play).not.toHaveBeenCalled();
  await click("timeline.play");
  await act(async () => vi.advanceTimersByTime(1200));
  expect(host.textContent).toContain("video");
  expect(h.player.play).toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.textContent).toContain("2.0 / 2.0 s");
  expect(host.textContent).toContain("timeline.play");
  await click("timeline.play");
  expect(host.textContent).toContain("image");
});
it("seeks to a clip paused and releases media in the background", async () => {
  await render();
  await click("2. Second · 1.0 s");
  expect(host.textContent).toContain("video");
  expect(h.player.play).not.toHaveBeenCalled();
  await click("timeline.play");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  expect(h.player.pause).toHaveBeenCalled();
  h.active = true;
  await render();
  expect(host.textContent).toContain("timeline.play");
  expect(host.textContent).toContain("0.0 / 2.0 s");
});
it("stops video errors and resets when the sequence version changes", async () => {
  await render();
  await click("2. Second · 1.0 s");
  await click("timeline.play");
  h.player.status = "error";
  await render();
  expect(host.textContent).toContain("thread.previewFailed");
  expect(host.textContent).toContain("timeline.play");
  await render({ ...sequence, version: 2 });
  expect(host.textContent).toContain("0.0 / 2.0 s");
});
it("preserves clip timing for missing/unsafe sources and handles exact boundaries", () => {
  const clips = timelinePlaybackClips({
    ...sequence,
    clips: sequence.clips.map((c) => ({
      ...c,
      selectedMediaVersion: { mediaKind: c.kind, previewUrl: "http://unsafe.example/media" },
    })),
  });
  expect(clips.every((c) => c.source === null)).toBe(true);
  expect(timelineClipAt(clips, 999)?.id).toBe("one");
  expect(timelineClipAt(clips, 1000)?.id).toBe("two");
  expect(timelineClipAt(clips, 2000)?.id).toBe("two");
  expect(timelineClipAt(clips, 2001)).toBeNull();
  expect(timelineClipAt(clips, NaN)).toBeNull();
});
