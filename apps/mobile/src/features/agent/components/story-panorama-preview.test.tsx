import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StoryPanoramaPreview } from "./story-panorama-preview";
const h = vi.hoisted(() => ({ load: vi.fn(), key: 0 }));
vi.mock("../api/story-canvas-panorama", () => ({ loadCanvasPanorama: h.load }));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => String(++h.key) } }));
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
vi.mock("./story-panorama-frame", () => ({
  StoryPanoramaFrame: ({ onEvent }: { onEvent(type: string): void }) => (
    <button onClick={() => onEvent("error")}>Lose context</button>
  ),
}));
const scope = { projectId: "p", documentId: "d", generation: 1 },
  source = { title: "Panorama", mediaAssetId: "asset" };
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.clearAllMocks();
});
it("aborts a pending image request on close/unmount", async () => {
  h.load.mockImplementation(() => new Promise(() => {}));
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root!.render(<StoryPanoramaPreview scope={scope} source={source} close={() => {}} />)
  );
  const signal = h.load.mock.calls[0]![2] as AbortSignal;
  expect(signal.aborted).toBe(false);
  await act(async () => root!.unmount());
  root = undefined;
  expect(signal.aborted).toBe(true);
});
it("replaces a failed renderer with a fresh request and fresh session on retry", async () => {
  h.load.mockResolvedValue("data:image/png;base64,AQ==");
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root!.render(<StoryPanoramaPreview scope={scope} source={source} close={() => {}} />)
  );
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Lose context")!.click()
  );
  expect(host.textContent).toContain("thread.previewFailed");
  expect(host.textContent).not.toContain("Lose context");
  const firstSignal = h.load.mock.calls[0]![2] as AbortSignal;
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "common.retry")!.click()
  );
  expect(firstSignal.aborted).toBe(true);
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Lose context");
});
