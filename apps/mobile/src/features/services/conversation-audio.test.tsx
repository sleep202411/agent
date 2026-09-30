import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationAudio } from "./conversation-audio";
const h = vi.hoisted(() => ({
  source: vi.fn(),
  player: { play: vi.fn(), pause: vi.fn(), seekTo: vi.fn() },
  status: {
    currentTime: 20,
    duration: 60,
    playing: false,
    isLoaded: true,
    isBuffering: false,
    error: null as string | null,
  },
}));
vi.mock("expo-audio", () => ({
  useAudioPlayer: (...args: unknown[]) => {
    h.source(...args);
    return h.player;
  },
  useAudioPlayerStatus: () => h.status,
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <div>loading</div>,
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = () =>
  act(async () => root.render(<ConversationAudio url="https://files.test/signed" />));
const click = (label: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === label)!
    .click();
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(h.status, {
    currentTime: 20,
    duration: 60,
    playing: false,
    isLoaded: true,
    isBuffering: false,
    error: null,
  });
  h.player.seekTo.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("plays only on request, displays progress, pauses and seeks within duration", async () => {
  await render();
  expect(h.source).toHaveBeenCalledWith(
    { uri: "https://files.test/signed" },
    { downloadFirst: false, updateInterval: 500 }
  );
  expect(h.player.play).not.toHaveBeenCalled();
  expect(host.textContent).toContain("0:20 / 1:00");
  await act(async () => click("thread.audioPlay"));
  expect(h.player.play).toHaveBeenCalledTimes(1);
  h.status.playing = true;
  await render();
  await act(async () => click("thread.audioPause"));
  expect(h.player.pause).toHaveBeenCalledTimes(1);
  h.status.currentTime = 5;
  await render();
  await act(async () => click("thread.audioBack"));
  expect(h.player.seekTo).toHaveBeenLastCalledWith(0);
  h.status.currentTime = 55;
  await render();
  await act(async () => click("thread.audioForward"));
  expect(h.player.seekTo).toHaveBeenLastCalledWith(60);
});
it("replays from the end and guards duplicate replay and late completion after close", async () => {
  h.status.currentTime = 60;
  let finish!: () => void;
  h.player.seekTo.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => {
    click("thread.audioPlay");
    click("thread.audioReplay");
  });
  expect(h.player.seekTo).toHaveBeenCalledExactlyOnceWith(0);
  expect(h.player.play).not.toHaveBeenCalled();
  await act(async () => root.render(<div />));
  expect(h.player.pause).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(h.player.play).not.toHaveBeenCalled();
});
it("shows load and playback errors and handles failed seek without an unhandled rejection", async () => {
  h.status.isLoaded = false;
  await render();
  expect(host.textContent).toContain("loading");
  expect(host.querySelector("button")!.disabled).toBe(true);
  h.status.isLoaded = true;
  h.player.seekTo.mockRejectedValue(new Error("seek failed"));
  await render();
  await act(async () => click("thread.audioReplay"));
  expect(host.textContent).toContain("thread.previewFailed");
  h.status.error = "native failure";
  await render();
  expect(host.querySelector("button")!.disabled).toBe(true);
});
