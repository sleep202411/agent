import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CanvasStoryboardPlayer } from "./canvas-storyboard-player";
const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  load: vi.fn(),
  end: undefined as (() => void) | undefined,
  play: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("../api/story-canvas-media-access", () => ({ loadCanvasMediaAccess: h.load }));
vi.mock("@/i18n", () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress(): void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("expo-image", () => ({
  Image: ({ onLoad, onError }: { onLoad(): void; onError(): void }) => (
    <>
      <button data-load onClick={onLoad}>
        Load
      </button>
      <button data-error onClick={onError}>
        Error
      </button>
    </>
  ),
}));
vi.mock("expo", () => ({
  useEvent: () => ({ status: "readyToPlay" }),
  useEventListener: (_: unknown, event: string, fn: () => void) => {
    if (event === "playToEnd") h.end = fn;
  },
}));
vi.mock("expo-video", () => ({
  useVideoPlayer: (_: unknown, init: (p: unknown) => void) => {
    const player = { play: h.play };
    init(player);
    return player;
  },
  VideoView: () => <span>Video</span>,
}));
const scope = { projectId: "p", documentId: "d", generation: 1 };
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
const ended = vi.fn();
const media = {
  id: "image",
  kind: "image" as const,
  name: "Image",
  url: "https://media.test/image.png",
};
const render = (kind: "image" | "video" = "image") =>
  act(async () =>
    root.render(
      <CanvasStoryboardPlayer media={{ ...media, kind }} scope={scope} autoPlay ended={ended} />
    )
  );
beforeEach(() => {
  vi.useFakeTimers();
  h.active = true;
  h.generation = 1;
  h.load.mockResolvedValue({ url: media.url, expiresAt: null });
  h.play.mockClear();
  ended.mockClear();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("starts still timing only after load and preserves remaining time on pause", async () => {
  await render();
  await act(async () => vi.advanceTimersByTime(10000));
  expect(ended).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("[data-load]")!.click());
  await act(async () => vi.advanceTimersByTime(2000));
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "storyboard.pause")!.click()
  );
  await act(async () => vi.advanceTimersByTime(10000));
  expect(ended).not.toHaveBeenCalled();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "storyboard.play")!.click()
  );
  await act(async () => vi.advanceTimersByTime(3000));
  expect(ended).toHaveBeenCalledTimes(1);
});
it("stops timers when the app backgrounds or the account changes", async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>("[data-load]")!.click());
  h.active = false;
  await render();
  await act(async () => vi.advanceTimersByTime(6000));
  expect(ended).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
  h.active = true;
  h.generation = 2;
  await render();
  expect(host.textContent).toBe("");
});
it("advances video only on its native end event", async () => {
  await render("video");
  expect(host.textContent).toContain("Video");
  expect(h.play).toHaveBeenCalled();
  expect(ended).not.toHaveBeenCalled();
  await act(async () => h.end!());
  expect(ended).toHaveBeenCalledTimes(1);
});
it("shows a failed access response without falling back to the saved URL", async () => {
  h.load.mockRejectedValueOnce(Error("Access revoked"));
  await render();
  expect(host.textContent).toContain("Access revoked");
  expect(host.querySelector("[data-load]")).toBeNull();
});
