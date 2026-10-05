import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudioProjectScreen from "@/app/studio-project";
const projectId = "11111111-1111-4111-8111-111111111111",
  workspaceId = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({
  status: "authenticated",
  generation: 1,
  active: true,
  canGoBack: true,
  params: {} as Record<string, unknown>,
  read: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  login: vi.fn(),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => h.params,
  useRouter: () => ({ canGoBack: () => h.canGoBack, back: h.back, replace: h.replace }),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation }),
  useAuthGate: () => ({ requireAuth: h.login }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/lib/navigation", () => ({ toHref: (s: string) => s }));
vi.mock("@/features/agent/api/platform-projects-api", () => ({ readPlatformProject: h.read }));
vi.mock("@/features/agent/platform-project-sections", () => ({
  PlatformProjectSections: ({ projectId, workspaceId, name, onClose }: any) => {
    const [draft, setDraft] = useState(false);
    return (
      <div>
        {projectId} {workspaceId} {name}
        <button onClick={() => setDraft(true)}>Edit chapter</button>
        {draft ? "Retained chapter draft" : null}
        <button onClick={onClose}>Close project</button>
      </div>
    );
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(<StudioProjectScreen />));
const click = (text: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "authenticated";
  h.generation = 1;
  h.active = true;
  h.canGoBack = true;
  h.params = { projectId, workspaceId };
  h.read.mockResolvedValue({ name: "Current project name" });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("reads current project access and identity before opening native chapters", async () => {
  await render();
  expect(h.read).toHaveBeenCalledWith(projectId, workspaceId, 1, expect.any(AbortSignal));
  expect(host.textContent).toContain("Current project name");
  expect(host.textContent).toContain(projectId);
  await click("Close project");
  expect(h.back).toHaveBeenCalledTimes(1);
});
it("retains the mounted chapter editor across backgrounding", async () => {
  await render();
  await click("Edit chapter");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.textContent).toContain("Retained chapter draft");
  expect(h.read).toHaveBeenCalledTimes(1);
});
it("supports denied-access retry without opening stale project content", async () => {
  h.read.mockRejectedValueOnce(new Error("Project access revoked"));
  await render();
  expect(host.textContent).toContain("Project access revoked");
  expect(host.textContent).not.toContain("Edit chapter");
  await click("common.retry");
  expect(host.textContent).toContain("Current project name");
});
it("does not read before authentication, and resumes the destination after sign-in", async () => {
  h.status = "hydrating";
  await render();
  expect(h.read).not.toHaveBeenCalled();
  h.status = "anonymous";
  await render();
  await click("login.signIn");
  expect(h.login).toHaveBeenCalledTimes(1);
  h.status = "authenticated";
  await render();
  expect(h.read).toHaveBeenCalledTimes(1);
});
it.each([
  { projectId: "invalid", workspaceId },
  { projectId, workspaceId: [workspaceId, workspaceId] },
  { projectId },
])("rejects malformed destination parameters %j", async (params) => {
  h.params = params;
  await render();
  expect(host.textContent).toContain("studioProjects.invalidLink");
  expect(h.read).not.toHaveBeenCalled();
});
it("returns a cold entry to its workspace instead of another project", async () => {
  h.canGoBack = false;
  await render();
  await click("Close project");
  expect(h.replace).toHaveBeenCalledWith(`/agent?workspace=${workspaceId}`);
});
it("retires previous project reads and drafts on destination or account changes", async () => {
  let complete!: (value: { name: string }) => void;
  h.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  await render();
  const signal = h.read.mock.calls[0][3] as AbortSignal;
  h.params = { projectId: workspaceId, workspaceId: projectId };
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => complete({ name: "Old project" }));
  expect(host.textContent).not.toContain("Old project");
  await click("Edit chapter");
  h.generation++;
  await render();
  expect(host.textContent).not.toContain("Retained chapter draft");
  expect(h.read).toHaveBeenLastCalledWith(workspaceId, projectId, 2, expect.any(AbortSignal));
});
