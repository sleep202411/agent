import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ConversationFile } from "./conversation-file";
const h = vi.hoisted(() => ({ access: vi.fn(), open: vi.fn(), active: true, generation: 1 }));
vi.mock("./conversation-audio", () => ({
  ConversationAudio: () => <div data-audio>audio-preview</div>,
}));
vi.mock("./conversation-video", () => ({
  ConversationVideo: () => <div data-video>video-preview</div>,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("expo-image", () => ({
  Image: ({
    source,
    cachePolicy,
    onError,
  }: {
    source: { uri: string };
    cachePolicy: string;
    onError: () => void;
  }) => (
    <button data-image={source.uri} data-cache={cachePolicy} onClick={onError}>
      image
    </button>
  ),
}));
vi.mock("@/features/crew-assets/api", () => ({ fetchCrewAssetAccess: h.access }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = () =>
  act(async () => root.render(<ConversationFile mediaAssetId="media" name="Clip" />));
const click = () => host.querySelector("button")!.click();
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("resolves access on each open, guards rapid taps and never renders the signed URL", async () => {
  let finish!: (v: unknown) => void;
  h.access
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    )
    .mockResolvedValue({ url: "https://files.test/new" });
  await render();
  expect(h.access).not.toHaveBeenCalled();
  await act(async () => {
    click();
    click();
  });
  expect(h.access).toHaveBeenCalledTimes(1);
  await act(async () => finish({ url: "https://files.test/signed" }));
  expect(h.open).toHaveBeenCalledWith("https://files.test/signed");
  expect(host.textContent).not.toContain("https:");
  await act(async () => click());
  expect(h.access).toHaveBeenCalledTimes(2);
  expect(h.open).toHaveBeenLastCalledWith("https://files.test/new");
});
it("aborts backgrounded opens and permits a fresh request when returning", async () => {
  let finish!: (v: unknown) => void;
  h.access
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    )
    .mockResolvedValue({ url: "https://files.test/new" });
  await render();
  await act(async () => click());
  const signal = h.access.mock.calls[0][1];
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ url: "https://files.test/stale" }));
  expect(h.open).not.toHaveBeenCalled();
  h.active = true;
  await render();
  await act(async () => click());
  expect(h.open).toHaveBeenCalledWith("https://files.test/new");
});
it("does not open for a changed account and keeps access failures retryable", async () => {
  h.access.mockRejectedValueOnce(new Error("Access revoked"));
  await render();
  await act(async () => click());
  expect(host.textContent).toContain("Access revoked");
  expect(host.querySelector("button")!.disabled).toBe(false);
  let finish!: (v: unknown) => void;
  h.access.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await act(async () => click());
  h.generation++;
  await act(async () => finish({ url: "https://files.test/stale" }));
  expect(h.open).not.toHaveBeenCalled();
});

const renderImage = () =>
  act(async () =>
    root.render(
      <ConversationFile
        mediaAssetId="media"
        name="Photo"
        mediaKind="image"
        contentType="image/jpeg"
      />
    )
  );
it("previews images in-app without caching and refreshes authorization on reopening", async () => {
  h.access.mockResolvedValue({ url: "https://files.test/image", expiresAt: null });
  await renderImage();
  await act(async () => click());
  expect(h.open).not.toHaveBeenCalled();
  expect(host.querySelector('[data-cache="none"]')).not.toBeNull();
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "thread.closePreview")!
      .click()
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => click());
  expect(h.access).toHaveBeenCalledTimes(2);
});
it("removes failed, expired and backgrounded previews", async () => {
  vi.useFakeTimers();
  h.access.mockResolvedValue({
    url: "https://files.test/image",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  });
  await renderImage();
  await act(async () => click());
  await act(async () => host.querySelector<HTMLButtonElement>("[data-image]")!.click());
  expect(host.textContent).toContain("thread.previewFailed");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => click());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  h.access.mockResolvedValue({ url: "https://files.test/image", expiresAt: null });
  await act(async () => click());
  h.active = false;
  await renderImage();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("clears image previews on account changes and leaves non-image files in the existing system viewer", async () => {
  h.access.mockResolvedValue({ url: "https://files.test/image", expiresAt: null });
  await renderImage();
  await act(async () => click());
  h.generation++;
  await renderImage();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await render();
  await act(async () => click());
  expect(h.open).toHaveBeenCalledTimes(1);
});

it("mounts video only after authorized access and removes it on close", async () => {
  h.access.mockResolvedValue({ url: "https://files.test/video", expiresAt: null });
  await act(async () =>
    root.render(
      <ConversationFile
        mediaAssetId="media"
        name="Film"
        mediaKind="video"
        contentType="video/mp4"
      />
    )
  );
  expect(host.querySelector("[data-video]")).toBeNull();
  await act(async () => click());
  expect(host.querySelector("[data-video]")).not.toBeNull();
  expect(h.open).not.toHaveBeenCalled();
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "thread.closePreview")!
      .click()
  );
  expect(host.querySelector("[data-video]")).toBeNull();
});

it("opens audio only after authorization and removes it when backgrounded", async () => {
  h.access.mockResolvedValue({ url: "https://files.test/audio", expiresAt: null });
  const show = () =>
    act(async () =>
      root.render(
        <ConversationFile
          mediaAssetId="media"
          name="Sound"
          mediaKind="audio"
          contentType="audio/mpeg"
        />
      )
    );
  await show();
  expect(host.querySelector("[data-audio]")).toBeNull();
  await act(async () => click());
  expect(host.querySelector("[data-audio]")).not.toBeNull();
  expect(h.open).not.toHaveBeenCalled();
  h.active = false;
  await show();
  expect(host.querySelector("[data-audio]")).toBeNull();
});
