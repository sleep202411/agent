import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import AgentHubScreen from "@/app/agent/index";
const h = vi.hoisted(() => ({
  generation: 1,
  authenticated: true,
  focused: true,
  list: vi.fn(),
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: h.push }),
  useFocusEffect: (fn: () => void | (() => void)) => {
    const focused = h.focused;
    useEffect(() => (focused ? fn() : undefined), [fn, focused]);
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation }),
  useAuthGate: () => ({ isAuthenticated: h.authenticated, requireAuth: vi.fn() }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/constants/theme", () => ({ Spacing: {}, MaxContentWidth: 500 }));
vi.mock("@/lib/navigation", () => ({ toHref: (s: string) => s }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children, onPress }: { children: ReactNode; onPress?: () => void }) => (
    <span onClick={onPress}>{children}</span>
  ),
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui", () => ({ ScreenHeader: () => null }));
vi.mock("@/features/agent", () => ({
  AGENT_OS_STORY_WORKBENCH_MODE: "story",
  createAgentProject: vi.fn(),
  isAgentOsId: () => true,
  loadAgentProjects: h.list,
  CreateStoryProjectForm: () => null,
  StoryProjectCard: ({ project }: { project: { title: string } }) => <span>{project.title}</span>,
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Alert: { alert: vi.fn() },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({
    children,
    refreshControl,
  }: {
    children: ReactNode;
    refreshControl: ReactNode;
  }) => (
    <div>
      {refreshControl}
      {children}
    </div>
  ),
  RefreshControl: ({ onRefresh }: { onRefresh: () => void }) => (
    <button onClick={onRefresh}>Refresh</button>
  ),
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<AgentHubScreen />));
const result = (title: string) => ({ workspaceId: "workspace", projects: [{ id: title, title }] });
function deferred() {
  let resolve!: (value: ReturnType<typeof result>) => void;
  const promise = new Promise<ReturnType<typeof result>>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.authenticated = true;
  h.focused = true;
  h.list.mockResolvedValue(result("Current"));
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("cancels superseded reads and ignores their late results", async () => {
  const old = deferred();
  h.list.mockReturnValueOnce(old.promise);
  await render();
  const signal = h.list.mock.calls[0][0] as AbortSignal;
  await act(async () => host.querySelector("button")!.click());
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(result("Stale")));
  expect(host.textContent).toContain("Current");
  expect(host.textContent).not.toContain("Stale");
});
it("cancels a request when the route loses focus", async () => {
  const old = deferred();
  h.list.mockReturnValueOnce(old.promise);
  await render();
  const signal = h.list.mock.calls[0][0] as AbortSignal;
  h.focused = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(result("Stale")));
  expect(host.textContent).not.toContain("Stale");
  h.focused = true;
  await render();
  expect(host.textContent).toContain("Current");
});
it("clears the previous account list immediately while the new account loads", async () => {
  await render();
  expect(host.textContent).toContain("Current");
  const next = deferred();
  h.list.mockReturnValueOnce(next.promise);
  h.generation++;
  await render();
  expect(host.textContent).not.toContain("Current");
  await act(async () => next.resolve(result("New account")));
  expect(host.textContent).toContain("New account");
});
it("discards pending reads on logout", async () => {
  const old = deferred();
  h.list.mockReturnValueOnce(old.promise);
  await render();
  const signal = h.list.mock.calls[0][0] as AbortSignal;
  h.authenticated = false;
  h.generation++;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(result("Private")));
  expect(host.textContent).not.toContain("Private");
});
