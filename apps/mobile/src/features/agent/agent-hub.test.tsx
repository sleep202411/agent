import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import AgentHubScreen from "@/app/agent/index";
vi.mock("@/features/agent/components/story-library-editor", () => ({
  StoryLibraryEditor: ({
    scope,
    onSaved,
  }: {
    scope: { projectId: string };
    onSaved: (archived: boolean) => void;
  }) => (
    <div>
      Editing {scope.projectId}
      <button onClick={() => onSaved(true)}>Archive fixture</button>
    </div>
  ),
}));
const h = vi.hoisted(() => ({
  generation: 1,
  workspaceParam: undefined as string | undefined,
  authenticated: true,
  focused: true,
  list: vi.fn(),
  workspaces: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/features/agent/text-adventures", () => ({
  TextAdventures: () => <span>Native Text Adventures</span>,
}));
vi.mock("@/features/agent/content-review-history", () => ({
  ContentReviewHistory: () => <span>Content review reports</span>,
}));
vi.mock("@/features/agent/workspace-analytics", () => ({
  WorkspaceAnalyticsScreen: () => <span>Workspace Analytics</span>,
}));
vi.mock("@/features/agent/platform-project-directory", () => ({
  PlatformProjectDirectory: () => <span>Platform Projects</span>,
}));
vi.mock("@/features/agent/studio-workspace-settings", () => ({
  StudioWorkspaceSettingsScreen: () => <span>Workspace Settings</span>,
}));
vi.mock("@/features/agent/studio-members", () => ({
  StudioMembers: () => <span>Studio Members</span>,
}));
vi.mock("@/features/agent/studio-invite-accept", () => ({
  StudioInviteAccept: () => <span>Accept Invite</span>,
}));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/features/agent/studio-invites", () => ({
  StudioInvites: () => <span>Invite Manager</span>,
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: h.push }),
  useLocalSearchParams: () => ({ workspace: h.workspaceParam }),
  useFocusEffect: (fn: () => void | (() => void)) => {
    const focused = h.focused;
    useEffect(() => (focused ? fn() : undefined), [fn, focused]);
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, user: { id: "owner" } }),
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
  createAgentProject: h.create,
  loadAgentWorkspaces: h.workspaces,
  canCreateStudioProject: (w: { role: string }) => w.role === "owner",
  isAgentOsId: () => true,
  loadAgentProjects: h.list,
  CreateStoryProjectForm: ({
    busy,
    onSubmit,
  }: {
    busy: boolean;
    onSubmit: (v: unknown) => void;
  }) => (
    <button disabled={busy} onClick={() => onSubmit({ title: "New", summary: null })}>
      Create
    </button>
  ),
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
  h.workspaceParam = undefined;
  h.authenticated = true;
  h.focused = true;
  h.list.mockResolvedValue(result("Current"));
  h.workspaces.mockResolvedValue([
    { id: "workspace", name: "Personal", isDefault: true, role: "owner" },
    { id: "shared", name: "Crew", isDefault: false, role: "viewer" },
  ]);
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

it("selects a shared workspace and withholds creation from viewers", async () => {
  await render();
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Create")).toBe(true);
  h.list.mockResolvedValue(result("Shared story"));
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Crew")!.click()
  );
  expect(h.list).toHaveBeenLastCalledWith(expect.any(AbortSignal), "shared");
  expect(host.textContent).toContain("Shared story");
  expect(host.textContent).toContain("agent.workspaceViewOnly");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Create")).toBe(false);
});
it("creates explicitly in the selected editable workspace", async () => {
  h.workspaces.mockResolvedValue([{ id: "shared", name: "Crew", isDefault: false, role: "owner" }]);
  h.create.mockResolvedValue({ project: { id: "new", title: "New" }, chapterId: "chapter" });
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Create")!.click()
  );
  expect(h.create).toHaveBeenCalledWith({ workspaceId: "shared", title: "New", summary: null });
});
it("requires an explicit workspace choice after access is revoked on refresh", async () => {
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Crew")!.click()
  );
  h.workspaces.mockResolvedValue([
    { id: "workspace", name: "Personal", isDefault: true, role: "owner" },
  ]);
  await act(async () => host.querySelector("button")!.click());
  expect(h.list).toHaveBeenLastCalledWith(expect.any(AbortSignal), "shared");
  expect(h.list).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("aiLab.workspaceUnavailable");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Create")).toBe(false);
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Crew")).toBe(false);
});
it("opens invitation management from an authorized project", async () => {
  h.list.mockResolvedValue({
    workspaceId: "workspace",
    projects: [{ id: "project", title: "Story", capabilities: ["story.admin"] }],
  });
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "studioInvites.title")!
      .click()
  );
  expect(host.textContent).toContain("Invite Manager");
});
it("opens native member management from readable story projects", async () => {
  h.list.mockResolvedValue({
    workspaceId: "workspace",
    projects: [{ id: "story", title: "Story", capabilities: ["story.read"] }],
  });
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "studioMembers.title")!
      .click()
  );
  expect(host.textContent).toContain("Studio Members");
});
it("opens workspace creation from the hub", async () => {
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "studioWorkspace.create")!
      .click()
  );
  expect(host.textContent).toContain("Workspace Settings");
});

it("keeps a revoked invite workspace explicit until the user chooses another", async () => {
  h.workspaceParam = "shared";
  await render();
  expect(h.list).toHaveBeenLastCalledWith(expect.any(AbortSignal), "shared");
  h.workspaces.mockResolvedValue([
    { id: "workspace", name: "Personal", isDefault: true, role: "owner" },
  ]);
  await act(async () => host.querySelector("button")!.click());
  expect(h.list).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("aiLab.workspaceUnavailable");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Create")).toBe(false);
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Personal")!.click()
  );
  expect(h.list).toHaveBeenLastCalledWith(expect.any(AbortSignal), "workspace");
  expect(host.textContent).not.toContain("aiLab.workspaceUnavailable");
});

it("opens native Text Adventures from the authenticated creation hub", async () => {
  await render();
  const entry = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "textAdventure.title"
  );
  expect(entry).toBeDefined();
  await act(async () => entry!.click());
  expect(host.textContent).toContain("Native Text Adventures");
});

it("opens Story project management and refreshes the library after archiving", async () => {
  h.list.mockResolvedValue({
    workspaceId: "workspace",
    projects: [
      { id: "story", title: "Story", capabilities: ["story.read", "story.edit", "story.admin"] },
    ],
  });
  await render();
  const entry = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "storyLibrary.title"
  );
  expect(entry).toBeDefined();
  await act(async () => entry!.click());
  expect(host.textContent).toContain("Editing story");
  h.list.mockResolvedValue({ workspaceId: "workspace", projects: [] });
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Archive fixture")!.click()
  );
  expect(host.textContent).not.toContain("Editing story");
  expect(host.textContent).toContain("agent.projectsEmpty");
});
it("does not expose Story management for read-only projects", async () => {
  h.list.mockResolvedValue({
    workspaceId: "workspace",
    projects: [{ id: "story", title: "Story", capabilities: ["story.read"] }],
  });
  await render();
  expect(host.textContent).not.toContain("storyLibrary.title");
});
