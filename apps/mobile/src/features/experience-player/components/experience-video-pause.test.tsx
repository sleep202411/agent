import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ExperienceRuntimeManifest,
  ExperienceRendererInstance,
} from "@repo/shared/experience-runtime";
import { ExperienceVideoRenderer } from "./experience-video-renderer";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";
const h = vi.hoisted(() => ({
  active: true,
  player: {
    playing: false,
    pause: vi.fn(),
    play: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: "span",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("./experience-video-platform", () => ({
  useVideoPlayer: () => h.player,
  VideoView: () => null,
}));
vi.mock("@/hooks/use-app-active", () => ({ useGatedScreenActive: () => h.active }));
vi.mock("../lib/experience-playback-delivery", () => ({ resolveExperienceVideoSource: vi.fn() }));
vi.mock("./experience-still-segment", () => ({ ExperienceStillSegment: () => null }));
vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (s: string) => s }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const manifest = {
  assets: [],
  localization: { defaultLocale: "en-US" },
} as unknown as ExperienceRuntimeManifest;
const completed = vi.fn();
const noop = () => {};
let root: Root;
const render = (id = "empty") =>
  act(async () =>
    root.render(
      <ExperienceVideoRenderer
        manifest={manifest}
        renderer={
          {
            instanceId: id,
            config: { sequence: [], fit: "contain", autoplay: true },
          } as unknown as ExperienceRendererInstance
        }
        copy={{ emptySequence: "No footage" } as ExperiencePlayerCopy}
        onCompleted={completed}
        onRuntimeError={noop}
        onTimelineTimeMs={noop}
      />
    )
  );
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  h.active = true;
  completed.mockClear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("does not skip an empty scene during a long pause", async () => {
  await render();
  await advance(2000);
  h.active = false;
  await render();
  await advance(20000);
  expect(completed).not.toHaveBeenCalled();
  h.active = true;
  await render();
  await advance(3999);
  expect(completed).not.toHaveBeenCalled();
  await advance(1);
  expect(completed).toHaveBeenCalledTimes(1);
});
it("starts a fresh placeholder duration for a different renderer", async () => {
  await render();
  await advance(5000);
  await render("new");
  await advance(1000);
  expect(completed).not.toHaveBeenCalled();
  await advance(5000);
  expect(completed).toHaveBeenCalledTimes(1);
});
