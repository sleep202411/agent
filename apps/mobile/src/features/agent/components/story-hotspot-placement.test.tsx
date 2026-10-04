import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ViewProps } from "react-native";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryHotspotPlacement } from "./story-hotspot-placement";
const h = vi.hoisted(() => ({
  active: true,
  fetch: vi.fn(),
  change: vi.fn(),
  stage: {} as ViewProps,
  player: {
    currentTime: 0,
    duration: 10,
    status: "readyToPlay",
    play: vi.fn(),
    pause: vi.fn(),
    seekBy: vi.fn(),
  },
}));
vi.mock("../api/story-timeline-api", () => ({ fetchTimelines: h.fetch }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("expo", () => ({
  useEvent: (_: unknown, event: string) =>
    event === "statusChange" ? { status: h.player.status } : { currentTime: 0 },
}));
vi.mock("expo-video", () => ({
  useVideoPlayer: () => h.player,
  VideoView: () => <span>footage</span>,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => <span>loading</span>,
  TextInput: () => <input />,
  View: (props: ViewProps) => {
    if (props.onResponderGrant) h.stage = props;
    return <div>{props.children}</div>;
  },
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
let root: Root, host: HTMLDivElement;
const scope = { projectId: "p", chapterId: "c", generation: 1 },
  rect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.change.mockReturnValue(true);
  h.fetch.mockResolvedValue([
    {
      plotNodeId: "node",
      clips: [
        {
          id: "clip",
          rank: 0,
          kind: "video",
          selectedMediaVersion: { mediaKind: "video", previewUrl: "https://example.com/video.mp4" },
        },
      ],
    },
  ]);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = (suspended = false, disabled = false) =>
  act(async () =>
    root.render(
      <StoryHotspotPlacement
        scope={scope}
        nodeId="node"
        frameProfile="portrait_9_16"
        value={rect}
        disabled={disabled}
        suspended={suspended}
        onChange={h.change}
      />
    )
  );
const event = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } }) as never;
it("commits a bounded placement only at release and cancels interrupted gestures", async () => {
  await render();
  await act(async () =>
    h.stage.onLayout!({ nativeEvent: { layout: { width: 100, height: 100 } } } as never)
  );
  expect(h.stage.onStartShouldSetResponder!(event(50, 50))).toBe(true);
  await act(async () => h.stage.onResponderGrant!(event(50, 50)));
  await act(async () => h.stage.onResponderMove!(event(100, 0)));
  expect(h.change).not.toHaveBeenCalled();
  await act(async () => h.stage.onResponderRelease!(event(100, 0)));
  expect(h.change).toHaveBeenCalledWith({ ...rect, x: 0.5, y: 0 });
  h.change.mockClear();
  await act(async () => h.stage.onResponderGrant!(event(50, 50)));
  await act(async () => h.stage.onResponderTerminate!(event(50, 50)));
  expect(h.change).not.toHaveBeenCalled();
});
it("pauses footage when covered, backgrounded and unmounted", async () => {
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "storyHotspot.play")!.click()
  );
  expect(h.player.play).toHaveBeenCalled();
  h.player.pause.mockClear();
  await render(true);
  expect(h.player.pause).toHaveBeenCalled();
  h.player.pause.mockClear();
  h.active = false;
  await render();
  expect(h.player.play).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  expect(h.player.pause).toHaveBeenCalled();
});
it("keeps read-only placement disabled and reports missing footage", async () => {
  h.fetch.mockResolvedValue([]);
  await render(false, true);
  await act(async () =>
    h.stage.onLayout!({ nativeEvent: { layout: { width: 100, height: 100 } } } as never)
  );
  expect(h.stage.onStartShouldSetResponder!(event(0, 0))).toBe(false);
  expect(host.textContent).toContain("storyHotspot.noFootage");
  expect(host.textContent).not.toContain("footage");
});
it("does not repeat a completed seek after buffering", async () => {
  h.player.status = "readyToPlay";
  await render();
  expect(h.player.seekBy).toHaveBeenCalledTimes(1);
  h.player.status = "loading";
  await render();
  h.player.status = "readyToPlay";
  await render();
  expect(h.player.seekBy).toHaveBeenCalledTimes(1);
});
