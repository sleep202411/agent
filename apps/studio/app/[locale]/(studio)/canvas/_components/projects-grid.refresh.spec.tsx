// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CanvasProjectsGrid } from "./projects-grid";
const state = vi.hoisted(() => ({
  query: new URLSearchParams(),
  workspaceId: "A",
  list: vi.fn(),
  callbacks: [] as {
    workspaceId: string;
    onEvent: (e: { kind: string; workspaceId: string }) => void;
  }[],
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
  useWorkspace: () => ({ activeWorkspace: { id: state.workspaceId }, loading: false }),
}));
vi.mock("@/lib/collab/projects-api", () => ({
  createProject: state.create,
  listProjects: state.list,
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
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
  TileCard: ({ title }: { title: string }) => <span>{title}</span>,
}));
vi.mock("@/components/project-card", () => ({ WorkflowPreview: () => null }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: () => null,
  DialogContent: () => null,
  DialogDescription: () => null,
  DialogFooter: () => null,
  DialogHeader: () => null,
  DialogTitle: () => null,
}));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.query = new URLSearchParams();
  state.workspaceId = "A";
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
