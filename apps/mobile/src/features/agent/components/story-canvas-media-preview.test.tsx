import { act, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryCanvasMediaPreview } from "./story-canvas-media-preview";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  active: true,
  generation: 1,
  reads: 0,
  kind: "image",
  removed: false,
}));
vi.mock("../api/story-canvas-media-access", () => ({ loadCanvasMediaAccess: h.load }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/i18n", () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress(): void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("expo-image", () => ({
  Image: ({ source, onError }: { source: { uri: string }; onError(): void }) => (
    <button data-image={source.uri} onClick={onError}>
      Image
    </button>
  ),
}));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <span>Video player</span>,
}));
vi.mock("@/features/services/conversation-audio", () => ({
  ConversationAudio: () => <span>Audio player</span>,
}));
vi.mock("./story-canvas-reader", () => ({
  StoryCanvasReader: ({ onResult }: { onResult(value: unknown): void }) => {
    useEffect(() => {
      h.reads++;
      onResult({
        documentId: "d",
        snapshot: {
          nodes: {},
          edges: {},
          groups: {},
          meta: {},
          assets: h.removed
            ? {}
            : {
                entry: {
                  id: "entry",
                  kind: h.kind,
                  name: "Fresh title",
                  url: "https://media.test/fresh",
                },
              },
        },
      });
    }, [onResult]);
    return null;
  },
}));
const scope = { projectId: "p", documentId: "d", generation: 1 };
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
const render = () =>
  act(async () =>
    root.render(<StoryCanvasMediaPreview scope={scope} assetId="entry" close={() => {}} />)
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  h.active = true;
  h.generation = 1;
  h.reads = 0;
  h.kind = "image";
  h.removed = false;
  h.load.mockReset();
  h.load.mockResolvedValue({ url: "https://media.test/fresh", expiresAt: null });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(["image", "video", "audio"])(
  "refreshes and renders %s without expiring a successful load timeout",
  async (kind) => {
    h.kind = kind;
    await render();
    expect(host.textContent).toContain(
      kind === "image" ? "Image" : kind === "video" ? "Video player" : "Audio player"
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(host.textContent).not.toContain("thread.previewFailed");
    h.active = false;
    await render();
    expect(host.textContent).toBe("");
    expect((h.load.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
  }
);
it("rejects a removed library entry without requesting its old URL", async () => {
  h.removed = true;
  await render();
  expect(host.textContent).toContain("no longer available");
  expect(h.load).not.toHaveBeenCalled();
});
it("unmounts expired playback and rereads on explicit retry", async () => {
  h.load.mockResolvedValue({
    url: "https://media.test/fresh",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  });
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1001);
  });
  expect(host.querySelector("[data-image]")).toBeNull();
  h.load.mockResolvedValue({ url: "https://media.test/renewed", expiresAt: null });
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "common.retry")!.click()
  );
  expect(h.reads).toBe(2);
  expect(host.querySelector("[data-image]")?.getAttribute("data-image")).toContain("renewed");
});
it("ignores access completed after backgrounding", async () => {
  let resolve!: (value: unknown) => void;
  h.load.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  h.active = false;
  await render();
  await act(async () => resolve({ url: "https://media.test/late", expiresAt: null }));
  expect(host.textContent).toBe("");
});
