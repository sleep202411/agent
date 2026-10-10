import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Layout from "@/app/agent/[projectId]/_layout";
const h = vi.hoisted(() => ({
  projectId: "00000000-0000-4000-8000-000000000002",
  chapterId: "00000000-0000-4000-8000-000000000005",
  requestedChapterId: "00000000-0000-4000-8000-000000000005",
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: h.projectId }),
  Tabs: Object.assign(({ children }: { children: ReactNode }) => <>{children}</>, {
    Screen: ({
      options,
    }: {
      options: { href: { pathname: string; params: Record<string, string> }; tabBarLabel: string };
    }) => (
      <a
        href={
          options.href.pathname.replace("[projectId]", options.href.params.projectId) +
          "?" +
          new URLSearchParams(options.href.params)
        }
      >
        {options.tabBarLabel}
      </a>
    ),
  }),
}));
vi.mock("@/features/agent/context/story-chapter-context", () => ({
  StoryChapterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useStoryChapterContext: () => ({
    chapterId: h.chapterId,
    requestedChapterId: h.requestedChapterId,
  }),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: "authenticated", generation: 1 }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@tabler/icons-react-native", () => ({
  IconLayoutGrid: () => null,
  IconMessageCircle: () => null,
  IconScript: () => null,
}));
vi.mock("@/features/agent/components/story-project-header-actions", () => ({
  StoryProjectHeaderActions: () => null,
}));
vi.mock("@/features/agent/components/story-project-header-back", () => ({
  StoryProjectHeaderBack: () => null,
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: () => null }));
vi.mock("@/components/themed-view", () => ({ ThemedView: () => null }));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Pressable: () => null,
  View: () => null,
  StyleSheet: { hairlineWidth: 1 },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  act(() => root.unmount());
});
it("keeps the selected chapter in every tab destination and updates it after selection changes", async () => {
  root = createRoot(host);
  for (const chapterId of [
    "00000000-0000-4000-8000-000000000005",
    "00000000-0000-4000-8000-000000000006",
  ]) {
    h.chapterId = chapterId;
    await act(async () => root.render(<Layout />));
    const links = [...host.querySelectorAll("a")].map((a) => new URL(a.href, "http://local"));
    expect(links.map((u) => u.pathname)).toEqual([
      `/agent/${h.projectId}`,
      `/agent/${h.projectId}/script`,
      `/agent/${h.projectId}/assets`,
    ]);
    expect(links.map((u) => u.searchParams.get("chapterId"))).toEqual([
      chapterId,
      chapterId,
      chapterId,
    ]);
  }
});

it("preserves an unavailable chapter in tab links instead of opening the default", async () => {
  root = createRoot(host);
  h.chapterId = "";
  await act(async () => root.render(<Layout />));
  const links = [...host.querySelectorAll("a")].map((a) => new URL(a.href, "http://local"));
  expect(links.map((u) => u.searchParams.get("chapterId"))).toEqual(
    Array(3).fill(h.requestedChapterId)
  );
});
