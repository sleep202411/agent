import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type {
  ExperienceRuntimeManifest,
  ExperienceRendererInstance,
} from "@repo/shared/experience-runtime";
import { ExperienceSubtitleProvider, ExperienceSubtitleControl } from "./experience-subtitles";
import {
  ExperienceVideoRenderer,
  type ExperienceMediaPlaybackHandle,
} from "./experience-video-renderer";
vi.mock("../lib/experience-playback-delivery", () => ({
  resolveExperienceVideoSource: async () => ({ uri: "https://example.invalid/video.mp4" }),
}));
vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (uri: string) => uri }));
const h = vi.hoisted(() => ({
  listeners: new Map<string, (data: any) => void>(),
  presenting: true,
  now: 0,
  player: {
    loop: false,
    currentTime: 0,
    duration: 10,
    playing: false,
    replaceAsync: vi.fn(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
    addListener: vi.fn(),
  },
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (s: unknown) => s, absoluteFill: {} },
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./experience-video-platform", () => ({
  useVideoPlayer: () => h.player,
  VideoView: () => null,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/hooks/use-app-active", () => ({ useGatedScreenActive: () => h.presenting }));
vi.mock("../lib/experience-media-cache", () => ({
  resolvePlaybackUri: async (uri: string) => uri,
}));
vi.mock("../lib/experience-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/experience-media")>()),
  resolveVideoMedia: () => ({
    variant: {
      uri: "https://example.invalid/video.mp4",
      mediaType: "video/mp4",
      durationMs: 10000,
    },
  }),
  isStillVideoVariant: () => false,
  sequenceTimelineOffsetMs: () => 0,
  stillClipDurationMs: () => 1000,
  EXPERIENCE_PLAY_ORIENTATION: "landscape",
  invalidatePlayableMediaUrl: vi.fn(),
}));
const tracks = [
  { language: "en-US", cues: [{ startMs: 1000, endMs: 2000, text: "Hello" }] },
  { language: "zh-CN", cues: [{ startMs: 1000, endMs: 2000, text: "你好" }] },
];
const renderer = {
  instanceId: "video",
  rendererId: "core.video",
  config: {
    fit: "contain",
    autoplay: true,
    sequence: [
      { clipId: "one", assetId: "one", subtitles: tracks, endBehavior: { behavior: "advance" } },
      {
        clipId: "two",
        assetId: "two",
        subtitles: [{ language: "en-US", cues: [{ startMs: 1000, endMs: 2000, text: "Second" }] }],
        endBehavior: { behavior: "hold-last-frame" },
      },
    ],
  },
} as unknown as ExperienceRendererInstance;
const manifest = {
  graph: { nodes: [{ kind: "scene", renderers: [renderer] }] },
  assets: [],
} as unknown as ExperienceRuntimeManifest;
let root: Root, container: HTMLDivElement, handle: ExperienceMediaPlaybackHandle | null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  h.listeners.clear();
  h.now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => h.now);
  h.presenting = true;
  h.player.currentTime = 0;
  h.player.addListener.mockImplementation((name, fn) => {
    h.listeners.set(name, fn);
    return { remove: () => h.listeners.delete(name) };
  });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <ExperienceSubtitleProvider manifest={manifest} locale="en-US">
        <ExperienceVideoRenderer
          manifest={manifest}
          renderer={renderer}
          copy={{ mediaError: () => "Error" } as any}
          onTimelineTimeMs={() => {}}
          onCompleted={() => {}}
          onRuntimeError={() => {}}
          onPlaybackHandle={(_id, value) => {
            handle = value;
          }}
        />
        <ExperienceSubtitleControl />
      </ExperienceSubtitleProvider>
    )
  );
}
async function time(currentTime: number) {
  h.now += Math.max(0, currentTime - h.player.currentTime) * 1000;
  h.player.currentTime = currentTime;
  await act(async () => h.listeners.get("timeUpdate")?.({ currentTime }));
}
it("uses clip time and exclusive cue ends, updates immediately on seek, and clears on transition", async () => {
  await render();
  await time(1);
  expect(container.textContent).toContain("Hello");
  await time(2);
  expect(container.textContent).not.toContain("Hello");
  await act(async () => handle?.seek(1.5));
  expect(container.textContent).toContain("Hello");
  await act(async () => h.listeners.get("playToEnd")?.({}));
  expect(container.textContent).not.toContain("Hello");
  await time(1.5);
  expect(container.textContent).toContain("Second");
  await act(async () => h.listeners.get("playToEnd")?.({}));
  expect(container.textContent).not.toContain("Second");
});
it("allows language selection and off without changing playback", async () => {
  await render();
  await time(1.5);
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "mobileSubtitles.zh-CN")!
      .click()
  );
  expect(container.textContent).toContain("你好");
  expect(container.textContent).not.toContain("Hello");
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "mobileSubtitles.off")!
      .click()
  );
  expect(container.textContent).not.toContain("你好");
});
it("hides captions while backgrounded and restores the current cue", async () => {
  await render();
  await time(1.5);
  h.presenting = false;
  await render();
  expect(container.textContent).not.toContain("Hello");
  h.presenting = true;
  await render();
  expect(container.textContent).toContain("Hello");
});
