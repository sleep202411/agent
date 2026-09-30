import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PersonalWorkPlayer } from "./personal-work-player";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  video: vi.fn(),
  player: { pause: vi.fn(), status: "ready" },
}));
vi.mock("./personal-work-api", () => ({ getPersonalWorkLink: h.load }));
vi.mock("expo", () => ({ useEvent: () => ({ status: h.player.status }) }));
vi.mock("expo-video", () => ({
  useVideoPlayer: (url: string) => {
    h.video(url);
    return h.player;
  },
  VideoView: () => <div>video</div>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ActivityIndicator: () => <span>loading</span>,
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = (id = "12") => act(async () => root.render(<PersonalWorkPlayer key={id} id={id} />));
beforeEach(() => {
  vi.resetAllMocks();
  h.player.status = "ready";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("fetches before mounting the player and pauses on removal", async () => {
  h.load.mockResolvedValue("https://media.test/signed");
  await render();
  expect(h.video).toHaveBeenCalledWith("https://media.test/signed");
  await act(async () => root.render(null));
  expect(h.player.pause).toHaveBeenCalled();
});
it("retries failed requests and player failures with a fresh signed link", async () => {
  h.load.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("https://media.test/fresh");
  await render();
  expect(host.textContent).toContain("courses.playError");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("video");
  h.player.status = "error";
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.load).toHaveBeenCalledTimes(3);
});
it("aborts and ignores a late response after moving to another work", async () => {
  let finish!: (value: string) => void;
  h.load
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue("https://media.test/new");
  await render("old");
  const signal = h.load.mock.calls[0][1] as AbortSignal;
  await render("new");
  expect(signal.aborted).toBe(true);
  await act(async () => finish("https://media.test/old"));
  expect(h.video).not.toHaveBeenCalledWith("https://media.test/old");
});
