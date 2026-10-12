import { act, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { AppStoryEntry } from "./app-story-entry";

const h = vi.hoisted(() => ({
  enabled: false,
  loading: false,
  platform: "ios",
  mounted: vi.fn(),
  unmounted: vi.fn(),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: 1, status: "authenticated" }) }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { enabled: h.enabled }, refetch: vi.fn() }),
}));
vi.mock("../context/story-chapter-context", () => ({
  useStoryChapterContext: () => ({
    projectId: "project",
    chapterId: "chapter",
    loading: h.loading,
    refresh: vi.fn(),
  }),
}));
vi.mock("./app-story-native-view", () => ({
  AppStoryNativeView: () => {
    useEffect(() => {
      h.mounted();
      return () => h.unmounted();
    }, []);
    return <div>native conversation</div>;
  },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: () => null }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return h.platform;
    },
  },
  ActivityIndicator: () => <div>loading</div>,
  Pressable: () => null,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  h.enabled = false;
  h.loading = false;
  h.platform = "ios";
  vi.clearAllMocks();
});

it("preserves the existing conversation when the regional gate is disabled or on Web", async () => {
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () => root.render(<AppStoryEntry legacy={<div>legacy</div>} />));
    expect(container.textContent).toBe("legacy");
    h.enabled = true;
    h.platform = "web";
    await act(async () => root.render(<AppStoryEntry legacy={<div>legacy</div>} />));
    expect(container.textContent).toBe("legacy");
    expect(h.mounted).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps an enabled native conversation mounted during chapter refresh", async () => {
  h.enabled = true;
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () => root.render(<AppStoryEntry legacy={<div>legacy</div>} />));
    h.loading = true;
    await act(async () => root.render(<AppStoryEntry legacy={<div>legacy</div>} />));
    expect(container.textContent).toBe("native conversation");
    expect(h.mounted).toHaveBeenCalledOnce();
    expect(h.unmounted).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
