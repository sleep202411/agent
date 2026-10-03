// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CanvasProjectsGrid } from "./projects-grid";
const state = vi.hoisted(() => ({
  query: new URLSearchParams(),
  workspaceId: "A",
  workspaceError: null as Error | null,
  workspaceFetching: false,
  refreshWorkspace: vi.fn(),
  list: vi.fn(),
  callbacks: [] as {
    workspaceId: string;
    onEvent: (e: { kind: string; workspaceId: string }) => void;
  }[],
  rename: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.query }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: state.push }),
  Link: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({
    activeWorkspace: state.workspaceId ? { id: state.workspaceId } : null,
    loading: false,
    error: state.workspaceError,
    fetching: state.workspaceFetching,
    refresh: state.refreshWorkspace,
  }),
}));
vi.mock("@/lib/collab/projects-api", () => ({
  createProject: state.create,
  listProjects: state.list,
  deleteProject: state.remove,
  renameProject: state.rename,
}));
vi.mock("@/lib/canvas-authoring/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: ({ workspaceId }: { workspaceId: string }) => ({
    subscribe: ({ onEvent }: { onEvent: (e: { kind: string; workspaceId: string }) => void }) => {
      state.callbacks.push({ workspaceId, onEvent });
      return { close() {} };
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: state.error, info: vi.fn() } }));
vi.mock("@/components/ui/tile-card", () => ({
  TileCard: ({ title, overlay }: { title: string; overlay: ReactNode }) => (
    <div>
      {title}
      {overlay}
    </div>
  ),
}));
vi.mock("@/components/project-card", () => ({ WorkflowPreview: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
  DropdownMenuTrigger: () => null,
  DropdownMenuSeparator: () => null,
}));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.query = new URLSearchParams();
  state.workspaceId = "A";
  state.workspaceError = null;
  state.workspaceFetching = false;
  state.callbacks = [];
  state.list.mockResolvedValue([]);
  state.create.mockResolvedValue({ id: "created" });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.resetAllMocks();
});
async function render() {
  await act(async () => root.render(<CanvasProjectsGrid />));
}

const row = (id: string) => ({
  id,
  name: id,
  workspaceId: id,
  status: "active",
  visibility: "private",
  updatedAt: new Date().toISOString(),
});
it("discards a realtime refresh that finishes after switching workspaces", async () => {
  await render();
  let finish!: (rows: unknown[]) => void;
  state.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => state.callbacks[0].onEvent({ kind: "project_changed", workspaceId: "A" }));
  state.workspaceId = "B";
  state.list.mockResolvedValue([row("B-project")]);
  await render();
  expect(host.textContent).toContain("B-project");
  await act(async () => finish([row("A-private-project")]));
  expect(host.textContent).toContain("B-project");
  expect(host.textContent).not.toContain("A-private-project");
});
it("keeps current-workspace realtime refresh working", async () => {
  await render();
  state.list.mockResolvedValue([row("A-new")]);
  await act(async () => state.callbacks[0].onEvent({ kind: "project_changed", workspaceId: "A" }));
  expect(host.textContent).toContain("A-new");
});
it("does not revive an old refresh when returning to the same workspace", async () => {
  await render();
  let finish!: (rows: unknown[]) => void;
  state.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => state.callbacks[0].onEvent({ kind: "project_changed", workspaceId: "A" }));
  state.workspaceId = "B";
  await render();
  state.workspaceId = "A";
  state.list.mockResolvedValue([row("A-current")]);
  await render();
  await act(async () => finish([row("A-stale")]));
  expect(host.textContent).toContain("A-current");
  expect(host.textContent).not.toContain("A-stale");
});

async function click(label: string, inDialog = false) {
  const scope = inDialog ? document.querySelector('[role="dialog"]')! : host;
  const button = Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function renameInput(value: string) {
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("shows an initial load failure and retries without creating anything", async () => {
  state.list.mockRejectedValueOnce(new Error("Workspace unavailable"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Workspace unavailable");
  state.list.mockResolvedValue([row("Recovered")]);
  await click("retry");
  expect(host.textContent).toContain("Recovered");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(state.create).not.toHaveBeenCalled();
});
it("retains the rename draft after failure and allows one retry", async () => {
  state.list.mockResolvedValue([row("Original")]);
  await render();
  await click("rename");
  await renameInput("New name");
  state.rename.mockRejectedValueOnce(new Error("Rename permission changed"));
  await click("rename", true);
  expect(state.error).toHaveBeenCalledWith("Rename permission changed");
  expect(document.querySelector("input")?.value).toBe("New name");
  state.rename.mockResolvedValue(undefined);
  state.list.mockResolvedValue([row("New name")]);
  await click("rename", true);
  expect(state.rename).toHaveBeenLastCalledWith("Original", "New name");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain("New name");
});
it("prevents duplicate deletes, preserves confirmation after failure, and separates refresh errors", async () => {
  state.list.mockResolvedValue([row("Original")]);
  await render();
  await click("delete");
  let reject!: (error: Error) => void;
  state.remove.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  await click("delete", true);
  await click("delete", true);
  expect(state.remove).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Cannot delete yet")));
  expect(state.error).toHaveBeenCalledWith("Cannot delete yet");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  state.remove.mockResolvedValue(undefined);
  state.list.mockRejectedValue(new Error("List temporarily unavailable"));
  await click("delete", true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).not.toContain("Original");
  expect(host.textContent).toContain("List temporarily unavailable");
  await click("retry");
  expect(state.remove).toHaveBeenCalledTimes(2);
});
it("ignores a rename response after changing workspace", async () => {
  state.list.mockResolvedValue([row("Original")]);
  await render();
  await click("rename");
  await renameInput("New name");
  let finish!: () => void;
  state.rename.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await click("rename", true);
  state.workspaceId = "B";
  state.list.mockResolvedValue([row("B-project")]);
  await render();
  await act(async () => finish());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain("B-project");
  expect(host.textContent).not.toContain("New name");
});
it("keeps existing projects visible when a realtime refresh fails", async () => {
  state.list.mockResolvedValue([row("Original")]);
  await render();
  state.list.mockRejectedValue(new Error("Connection lost"));
  await act(async () =>
    state.callbacks.at(-1)!.onEvent({ kind: "project_changed", workspaceId: "A" })
  );
  expect(host.textContent).toContain("Original");
  expect(host.textContent).toContain("Connection lost");
});

it("recovers workspace lookup failures before reading or creating canvases", async () => {
  state.workspaceError = new Error("Workspace service unavailable");
  await render();
  expect(host.textContent).toContain("Workspace service unavailable");
  expect(state.list).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("newCanvas");
  act(() => host.querySelector("button")!.click());
  expect(state.refreshWorkspace).toHaveBeenCalledOnce();
  state.workspaceFetching = true;
  await render();
  expect(host.querySelector("button")!.disabled).toBe(true);
  state.workspaceFetching = false;
  state.workspaceError = null;
  await render();
  expect(state.list).toHaveBeenCalledWith("A");
  expect(host.textContent).not.toContain("Workspace service unavailable");
});
it("offers workspace retry when an explicit target is unavailable", async () => {
  state.query.set("ws", "missing");
  state.workspaceId = "";
  await render();
  expect(host.textContent).toContain("workspaceUnavailable");
  act(() => host.querySelector("button")!.click());
  expect(state.refreshWorkspace).toHaveBeenCalledOnce();
  expect(state.list).not.toHaveBeenCalled();
});
