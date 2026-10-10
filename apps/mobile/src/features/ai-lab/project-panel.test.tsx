import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ProjectGenerationPanel } from "./project-panel";
vi.mock("./casting-invites-panel", () => ({
  CastingInvitesPanel: ({ onBack }: { onBack: () => void }) => (
    <button onClick={onBack}>casting-back</button>
  ),
}));
vi.mock("./skill-management-panel", () => ({ SkillManagementPanel: () => null }));
const h = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
  busy: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (_: string, user: string, id: string) => ({
    read: () => h.records.get(user + id) ?? null,
    write: (s: string) => h.records.set(user + id, s),
  }),
}));
vi.mock("./projects-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./projects-api")>()),
  getGenerationProject: h.get,
  listGenerationProjects: h.list,
}));
vi.mock("@/features/agent/api/studio-projects-api", () => ({ canCreateStudioProject: () => true }));
vi.mock("./panel", () => ({
  GenerationPanel: ({
    project,
    onBusyChange,
  }: {
    project?: { title: string; canGenerate: boolean };
    onBusyChange: (b: boolean) => void;
  }) => (
    <div>
      composer:{project?.title ?? "workspace"}:{String(project?.canGenerate ?? true)}
      <button onClick={() => onBusyChange(true)}>start</button>
      <button onClick={() => onBusyChange(false)}>finish</button>
    </div>
  ),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
const workspace = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Team",
    isDefault: false,
    accessScope: "workspace" as const,
    role: "editor" as const,
  },
  id = "22222222-2222-4222-8222-222222222222";
const project = {
  id,
  projectId: id,
  workspaceId: workspace.id,
  kind: "platform" as const,
  title: "Creative",
  canGenerate: true,
};
let root: Root, host: HTMLDivElement;
const mount = (projectOnly = false) =>
  act(async () =>
    root.render(
      <ProjectGenerationPanel
        userId="alice"
        generation={1}
        workspace={{ ...workspace, accessScope: projectOnly ? "project_only" : "workspace" }}
        onBusyChange={h.busy}
      />
    )
  );
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const click = (name: string) => act(async () => button(name).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.list.mockResolvedValue([{ id, kind: "platform", title: "Creative" }]);
  h.get.mockResolvedValue(project);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("selects and restores project context and prevents switching during operations", async () => {
  await mount();
  expect(host.textContent).toContain("composer:workspace");
  expect(h.list).not.toHaveBeenCalled();
  await click("aiLab.project: aiLab.noProject");
  await click("Creative · aiLab.creativeProject");
  expect(host.textContent).toContain("composer:Creative:true");
  await click("start");
  expect(button("aiLab.project: Creative").disabled).toBe(true);
  await click("finish");
  await act(async () => root.render(null));
  await mount();
  expect(host.textContent).toContain("composer:Creative:true");
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("never falls back from an unavailable saved project, and reads revoked edit access on refresh", async () => {
  h.records.set("alice" + workspace.id, JSON.stringify({ kind: "platform", id }));
  await mount();
  h.get.mockResolvedValue({ ...project, canGenerate: false });
  await click("aiLab.refreshProjects");
  expect(host.textContent).toContain("composer:Creative:false");
  h.get.mockRejectedValue(Error("Project no longer accessible"));
  await click("aiLab.refreshProjects");
  expect(host.textContent).not.toContain("composer:");
  expect(h.records.get("alice" + workspace.id)).toContain(id);
  await click("aiLab.project: aiLab.chooseProject");
  await click("aiLab.noProject");
  expect(host.textContent).toContain("composer:workspace");
});
it("project-only membership never opens a workspace composer or workspace billing option", async () => {
  await mount(true);
  expect(host.textContent).not.toContain("composer:");
  await click("aiLab.project: aiLab.noProject");
  expect(button("aiLab.noProject")).toBeUndefined();
  await click("Creative · aiLab.creativeProject");
  expect(host.textContent).toContain("composer:Creative:true");
});

it("opens casting only for Creative editors and returns to the existing composer", async () => {
  await mount();
  await click("aiLab.project: aiLab.noProject");
  await click("Creative · aiLab.creativeProject");
  await click("casting.title");
  expect(host.textContent).toContain("casting-back");
  expect(host.textContent).not.toContain("composer:");
  await click("casting-back");
  expect(host.textContent).toContain("composer:Creative:true");
  h.get.mockResolvedValue({ ...project, canGenerate: false });
  await click("aiLab.refreshProjects");
  expect(button("casting.title")).toBeUndefined();
});
