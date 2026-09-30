import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationVideo } from "./conversation-video";
const h = vi.hoisted(() => ({
  source: vi.fn(),
  status: "readyToPlay",
  player: { pause: vi.fn(), play: vi.fn(), staysActiveInBackground: true, status: "readyToPlay" },
  view: vi.fn(),
  close: vi.fn(),
}));
vi.mock("expo", () => ({ useEvent: () => ({ status: h.status }) }));
vi.mock("expo-video", () => ({
  useVideoPlayer: (source: unknown, setup: (p: typeof h.player) => void) => {
    h.source(source);
    setup(h.player);
    return h.player;
  },
  VideoView: (props: unknown) => {
    h.view(props);
    return <div>video</div>;
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
const render = () =>
  act(async () =>
    root.render(<ConversationVideo url="https://files.test/private" onRetry={h.close} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "readyToPlay";
  h.player.staysActiveInBackground = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("uses authorized uncached media, native controls and pauses when removed", async () => {
  await render();
  expect(h.source).toHaveBeenCalledWith({ uri: "https://files.test/private", useCaching: false });
  expect(h.player.staysActiveInBackground).toBe(false);
  expect(h.player.play).not.toHaveBeenCalled();
  expect(h.view.mock.calls[0][0]).toMatchObject({
    nativeControls: true,
    allowsPictureInPicture: false,
  });
  await act(async () => root.render(<div />));
  expect(h.player.pause).toHaveBeenCalledTimes(1);
});
it("shows loading and recoverable playback errors", async () => {
  h.status = "loading";
  await render();
  expect(host.textContent).toContain("loading");
  h.status = "error";
  await render();
  expect(host.textContent).toContain("thread.previewFailed");
  await act(async () => host.querySelector("button")!.click());
  expect(h.close).toHaveBeenCalledTimes(1);
});
