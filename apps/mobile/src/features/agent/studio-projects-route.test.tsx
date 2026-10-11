import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudioProjectsScreen from "@/app/studio-projects";
const id = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({
  status: "authenticated",
  generation: 1,
  active: true,
  params: {} as Record<string, unknown>,
  read: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  login: vi.fn(),
  canGoBack: true,
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
vi.mock("@/features/agent/api/studio-projects-api", () => ({ readStudioWorkspace: h.read }));
vi.mock("@/features/agent/platform-project-directory", () => ({
  PlatformProjectDirectory: ({
    workspace,
    onClose,
  }: {
    workspace: { id: string; name: string };
    onClose(): void;
  }) => {
    const [draft, setDraft] = useState(false);
    return (
      <div>
        {workspace.id} {workspace.name}
        <button onClick={() => setDraft(true)}>Edit</button>
        {draft && "Retained draft"}
        <button onClick={onClose}>Close</button>
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
  Pressable: ({ children, onPress }: { children: ReactNode; onPress(): void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const render = () => act(async () => root.render(<StudioProjectsScreen />));
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
  h.params = { workspaceId: id };
  h.read.mockResolvedValue({ id, name: "Invited team" });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("opens the exact authorized workspace and preserves directory edits across backgrounding", async () => {
  await render();
  expect(h.read).toHaveBeenCalledWith(id, 1, expect.any(AbortSignal));
  expect(host.textContent).toContain("Invited team");
  await click("Edit");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.textContent).toContain("Retained draft");
  expect(h.read).toHaveBeenCalledTimes(1);
  await click("Close");
  expect(h.back).toHaveBeenCalledOnce();
});
it("keeps revoked workspace errors explicit and retries instead of choosing a default", async () => {
  h.read.mockRejectedValueOnce(new Error("Workspace removed"));
  await render();
  expect(host.textContent).toContain("Workspace removed");
  expect(host.textContent).not.toContain("Edit");
  await click("common.retry");
  expect(h.read).toHaveBeenLastCalledWith(id, 1, expect.any(AbortSignal));
  expect(host.textContent).toContain("Invited team");
});
it("waits for authentication and resumes the original workspace", async () => {
  h.status = "hydrating";
  await render();
  expect(h.read).not.toHaveBeenCalled();
  h.status = "anonymous";
  await render();
  await click("login.signIn");
  expect(h.login).toHaveBeenCalledOnce();
  h.status = "authenticated";
  await render();
  expect(host.textContent).toContain(id);
});
it.each([undefined, "", "bad", [id, id]])("rejects invalid workspace %j", async (workspaceId) => {
  h.params = { workspaceId };
  await render();
  expect(host.textContent).toContain("studioWorkspace.invalidLink");
  expect(h.read).not.toHaveBeenCalled();
});
it("returns cold entries to the hub without inventing another workspace", async () => {
  h.canGoBack = false;
  await render();
  await click("Close");
  expect(h.replace).toHaveBeenCalledWith("/agent");
});
it("retires late reads and drafts on account changes", async () => {
  let finish!: (value: unknown) => void;
  h.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.read.mock.calls[0][2] as AbortSignal;
  h.generation++;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ id, name: "Old account" }));
  expect(host.textContent).not.toContain("Old account");
  await click("Edit");
  h.generation++;
  await render();
  expect(host.textContent).not.toContain("Retained draft");
});
