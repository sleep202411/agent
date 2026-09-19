// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CanvasProjectsGrid } from "./projects-grid";
const state = vi.hoisted(() => ({
  query: new URLSearchParams(),
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
  useWorkspace: () => ({ activeWorkspace: { id: "workspace" }, loading: false }),
}));
vi.mock("@/lib/collab/projects-api", () => ({
  createProject: state.create,
  listProjects: async () => [],
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
}));
vi.mock("@/lib/canvas-authoring/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: () => ({ subscribe: () => ({ close() {} }) }),
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
async function create() {
  await act(async () => host.querySelector("button")!.click());
}
it("preserves a decoded Home prompt only after explicit creation", async () => {
  state.query = new URLSearchParams("prompt=%20%E5%A4%9C%E6%99%AF%20%26%20rain%0Asecond%20line%20");
  await render();
  expect(state.create).not.toHaveBeenCalled();
  await create();
  expect(state.create).toHaveBeenCalledExactlyOnceWith("workspace", {
    name: "untitledCanvas",
    initialSectionTitle: "defaultTitle",
    description: "夜景 & rain\nsecond line",
  });
  expect(state.push).toHaveBeenCalledExactlyOnceWith("/project/created");
});
it.each([null, "   "])("keeps ordinary empty-canvas creation unchanged (%s)", async (value) => {
  if (value !== null) state.query.set("prompt", value);
  await render();
  await create();
  expect(state.create.mock.calls[0][1]).not.toHaveProperty("description");
});
it("retains the prompt after failure for an explicit retry", async () => {
  state.query.set("prompt", "original");
  state.create.mockRejectedValueOnce(new Error("failed"));
  await render();
  await create();
  expect(state.push).not.toHaveBeenCalled();
  expect(state.query.get("prompt")).toBe("original");
  await create();
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(state.create.mock.calls[1][1].description).toBe("original");
});
it("uses the current URL prompt and never silently truncates it", async () => {
  state.query.set("prompt", "old");
  await render();
  state.query = new URLSearchParams({ prompt: "新".repeat(5001) });
  await render();
  await create();
  expect(state.create.mock.calls[0][1].description).toBe("新".repeat(5001));
});
it("does not submit twice while creation is pending", async () => {
  let finish!: (value: { id: string }) => void;
  state.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await create();
  await create();
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () => finish({ id: "created" }));
});
