import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Layout from "@/app/agent/[projectId]/_layout";
const h = vi.hoisted(() => ({
  status: "anonymous",
  generation: 1,
  login: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation }),
  useAuthGate: () => ({ requireAuth: h.login }),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "11111111-1111-4111-8111-111111111111" }),
  Tabs: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, {
    Screen: ({ name }: { name: string }) => <span>{name}</span>,
  }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
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
vi.mock("@/features/agent/context/story-chapter-context", () => ({
  StoryChapterProvider: ({ children }: { children: ReactNode }) => {
    useEffect(() => {
      h.mount(h.generation);
      return () => {
        h.unmount();
      };
    }, []);
    return <div>{children}</div>;
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native", () => ({
  StyleSheet: { hairlineWidth: 1 },
  ActivityIndicator: () => <span>Loading</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<Layout />));
beforeEach(() => {
  vi.clearAllMocks();
  h.status = "anonymous";
  h.generation = 1;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("does not mount private project reads for guests and offers sign-in repeatedly", async () => {
  await render();
  expect(h.mount).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  expect(h.login).toHaveBeenCalledOnce();
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.login).toHaveBeenCalledTimes(2);
});
it("waits for auth hydration without mounting private tabs", async () => {
  h.status = "hydrating";
  await render();
  expect(host.textContent).toBe("Loading");
  expect(h.mount).not.toHaveBeenCalled();
});
it("keeps all signed-in tabs and remounts private state across account sessions", async () => {
  h.status = "authenticated";
  await render();
  expect(host.textContent).toBe("indexscriptassets");
  expect(h.mount).toHaveBeenCalledWith(1);
  h.generation = 2;
  await render();
  expect(h.unmount).toHaveBeenCalledOnce();
  expect(h.mount).toHaveBeenLastCalledWith(2);
  h.status = "anonymous";
  await render();
  expect(h.unmount).toHaveBeenCalledTimes(2);
  expect(host.textContent).toBe("login.signIn");
});
