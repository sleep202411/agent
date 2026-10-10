import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { WorkspaceGenerationPanel, canReadGenerationWorkspace } from "./workspace-panel";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  focused: true,
  load: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (_ns: string, user: string) => ({
    read: () => h.records.get(user) ?? null,
    write: (s: string) => h.records.set(user, s),
  }),
}));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentWorkspaces: h.load,
  canCreateStudioProject: (w: { role: string }) => w.role === "owner" || w.role === "editor",
}));
vi.mock("./project-panel", () => ({
  ProjectGenerationPanel: ({
    workspace,
    onBusyChange,
  }: {
    workspace: { name: string };
    onBusyChange: (v: boolean) => void;
  }) => (
    <div>
      composer:{workspace.name}
      <button onClick={() => onBusyChange(true)}>start write</button>
      <button onClick={() => onBusyChange(false)}>finish write</button>
    </div>
  ),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children, style }: { children: ReactNode; style?: { display?: "none" | "flex" } }) => (
    <div style={{ display: style?.display }}>{children}</div>
  ),
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const personal = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Personal",
    isDefault: true,
    role: "owner" as const,
    accessScope: "workspace" as const,
  },
  team = {
    ...personal,
    id: "22222222-2222-4222-8222-222222222222",
    name: "Team",
    isDefault: false,
    role: "editor" as const,
  };
const mount = () =>
  act(async () => root.render(<WorkspaceGenerationPanel userId="alice" generation={1} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((x) => x.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.load.mockResolvedValue([personal, team]);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("restores selected workspace, keeps the roster compact and prevents switching during writes", async () => {
  await mount();
  expect(host.textContent).toContain("composer:Personal");
  expect(button("Team")).toBeUndefined();
  await click("aiLab.workspace: Personal");
  await click("Team");
  expect(host.textContent).toContain("composer:Team");
  expect(h.records.get("alice")).toBe(team.id);
  await click("start write");
  expect(button("aiLab.workspace: Team").disabled).toBe(true);
  expect(button("aiLab.refreshWorkspaces").disabled).toBe(true);
  await click("finish write");
  await act(async () => root.render(null));
  await mount();
  expect(host.textContent).toContain("composer:Team");
});
it("never silently falls back to another billing workspace when access disappears", async () => {
  h.records.set("alice", team.id);
  await mount();
  h.load.mockResolvedValue([personal]);
  await click("aiLab.refreshWorkspaces");
  expect(host.textContent).toContain("aiLab.workspaceUnavailable");
  expect(host.textContent).not.toContain("composer:");
  expect(h.records.get("alice")).toBe(team.id);
  await click("Personal");
  expect(host.textContent).toContain("composer:Personal");
});
it("fails closed on roster errors and after account or foreground changes", async () => {
  await mount();
  h.load.mockRejectedValue(Error("Access revoked"));
  await click("aiLab.refreshWorkspaces");
  expect(host.textContent).toContain("Access revoked");
  expect(host.textContent).not.toContain("composer:");
  h.active = false;
  await mount();
  expect((host.firstElementChild as HTMLElement).style.display).toBe("none");
  h.active = true;
  h.focused = true;
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
it("allows project-only workspaces to reach the project selector without implying workspace-wide access", () => {
  expect(canReadGenerationWorkspace({ ...team, role: "viewer" })).toBe(true);
  expect(canReadGenerationWorkspace({ ...team, accessScope: "project_only" })).toBe(true);
  expect(
    canReadGenerationWorkspace({ ...team, accessScope: "project_only", crewRole: "viewer" })
  ).toBe(true);
  expect(canReadGenerationWorkspace({ ...team, status: "archived" })).toBe(false);
});

it("keeps the workspace composer busy through background and retires it on route exit", async () => {
  await mount();
  await click("start write");
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  expect(button("aiLab.refreshWorkspaces").disabled).toBe(true);
  expect(h.load).toHaveBeenCalledTimes(1);
  await click("finish write");
  expect(button("aiLab.refreshWorkspaces").disabled).toBe(false);
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  expect(h.load).toHaveBeenCalledTimes(2);
});
