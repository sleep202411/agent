import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DiscoveryPreview } from "./discovery-preview";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  source: vi.fn(),
  view: vi.fn(),
  status: "readyToPlay",
  playing: true,
  player: {
    pause: vi.fn(),
    play: vi.fn(),
    staysActiveInBackground: true,
    muted: false,
    loop: false,
    status: "readyToPlay",
    playing: true,
  },
}));
vi.mock("@/data/ip-api", () => ({ fetchIpPreview: h.load }));
vi.mock("expo", () => ({
  useEvent: (_: unknown, name: string) =>
    name === "statusChange" ? { status: h.status } : { isPlaying: h.playing },
}));
vi.mock("expo-video", () => ({
  useVideoPlayer: (source: unknown, setup: (p: typeof h.player) => void) =>
    useState(() => {
      h.source(source);
      setup(h.player);
      return h.player;
    })[0],
  VideoView: (props: unknown) => {
    h.view(props);
    return <div data-video />;
  },
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <div>loading</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = (id = "one") =>
  act(async () => root.render(<DiscoveryPreview key={id} ipId={id} />));
const click = (text: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "readyToPlay";
  h.playing = true;
  h.load.mockResolvedValue("https://cdn.test/preview.mp4");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("autoplays the resolved preview muted, supports playback controls and pauses on removal", async () => {
  await render();
  expect(h.source).toHaveBeenCalledWith({ uri: "https://cdn.test/preview.mp4", useCaching: false });
  expect(h.player).toMatchObject({ muted: true, loop: true, staysActiveInBackground: false });
  expect(h.player.play).toHaveBeenCalledTimes(1);
  expect(h.view.mock.calls[0][0]).toMatchObject({
    nativeControls: false,
    allowsPictureInPicture: false,
    fullscreenOptions: { enable: false },
  });
  await click("discovery.unmute");
  expect(h.player.muted).toBe(false);
  await click("discovery.pause");
  expect(h.player.pause).toHaveBeenCalledTimes(1);
  h.playing = false;
  await render();
  await click("discovery.play");
  expect(h.player.play).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  expect(h.player.pause).toHaveBeenCalledTimes(2);
  expect(h.load.mock.calls[0][1].aborted).toBe(true);
});
it("ignores a late previous-card response and aborts its request", async () => {
  let resolve!: (url: string) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  const signal = h.load.mock.calls[0][1];
  await render("two");
  expect(signal.aborted).toBe(true);
  await act(async () => resolve("https://cdn.test/stale.mp4"));
  expect(h.source).not.toHaveBeenCalledWith(
    expect.objectContaining({ uri: "https://cdn.test/stale.mp4" })
  );
});
it("keeps a missing preview distinct from a retryable fetch failure", async () => {
  h.load.mockResolvedValueOnce(undefined);
  await render();
  expect(host.textContent).toContain("discovery.noPreview");
  expect(h.source).not.toHaveBeenCalled();
  h.load.mockRejectedValueOnce(Error("offline"));
  await render("two");
  expect(host.textContent).toContain("discovery.previewFailed");
  await click("common.retry");
  expect(host.querySelector("[data-video]")).not.toBeNull();
});
it("reloads authoritative preview metadata after playback fails", async () => {
  h.status = "error";
  await render();
  expect(host.textContent).toContain("discovery.previewFailed");
  h.status = "readyToPlay";
  await click("common.retry");
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(h.player.pause).toHaveBeenCalledTimes(1);
});

it("provides immediate scroll pause and resumes only playback that was running", async () => {
  const playback = { current: null as null | { pause: () => void; resume: () => void } };
  await act(async () => root.render(<DiscoveryPreview ipId="one" playback={playback} />));
  h.player.playing = true;
  playback.current!.pause();
  expect(h.player.pause).toHaveBeenCalledTimes(1);
  playback.current!.resume();
  expect(h.player.play).toHaveBeenCalledTimes(2);
  h.player.playing = false;
  playback.current!.pause();
  playback.current!.resume();
  expect(h.player.play).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  expect(playback.current).toBeNull();
});
