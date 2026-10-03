// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";
const state = vi.hoisted(() => ({
  userId: "a",
  workspaceId: "workspace-a",
  get: vi.fn(),
  projects: vi.fn(),
  members: vi.fn(),
  jobs: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.userId } }),
}));
vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ activeWorkspace: { id: state.workspaceId }, loading: false }),
}));
vi.mock("@/lib/api", () => ({ api: { get: state.get } }));
vi.mock("@/lib/collab/projects-api", () => ({ listProjects: state.projects }));
vi.mock("@/lib/collab/sharing-api", () => ({ listWorkspaceMembers: state.members }));
vi.mock("@/lib/canvas-authoring/generation-api", () => ({
  listFizzAiJobs: state.jobs,
  generationStatusFromRaw: (value: string) => value,
}));
describe("analytics account and workspace ownership", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  const render = async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Page />
        </QueryClientProvider>
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    state.userId = "a";
    state.workspaceId = "workspace-a";
    state.get
      .mockReset()
      .mockImplementation((path: string) =>
        Promise.resolve(
          path.endsWith("member-usage")
            ? { members: [] }
            : path.endsWith("daily-usage")
              ? { days: [] }
              : { entries: [] }
        )
      );
    state.projects.mockReset().mockResolvedValue([{ id: "project-a", name: "Project A" }]);
    state.members.mockReset().mockResolvedValue([{ userId: "a", isSelf: true, role: "admin" }]);
    state.jobs.mockReset().mockResolvedValue({ jobs: [] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  it("does not reuse another viewer's fresh analytics cache", async () => {
    await render();
    const calls = state.get.mock.calls.length;
    state.userId = "b";
    state.projects.mockResolvedValue([{ id: "project-b", name: "Project B" }]);
    await render();
    expect(state.get.mock.calls.length).toBeGreaterThan(calls);
    expect(container.textContent).not.toContain("Project A");
    expect(container.textContent).toContain("Project B");
    expect(
      client
        .getQueryCache()
        .findAll()
        .filter((q) => q.queryKey[1] === "analytics")
        .every((q) => q.queryKey.includes("a") || q.queryKey.includes("b"))
    ).toBe(true);
  });
  it("cancels abandoned reads and resets project filters on workspace change", async () => {
    await render();
    state.get.mockImplementation((path: string, options: { params?: { projectId?: string } }) =>
      path.endsWith("daily-usage") && options.params?.projectId
        ? new Promise(() => {})
        : Promise.resolve(
            path.endsWith("member-usage")
              ? { members: [] }
              : path.endsWith("daily-usage")
                ? { days: [] }
                : { entries: [] }
          )
    );
    const select = container.querySelector(
      'select[aria-label="projectFilter"]'
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = "project-a";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const old = state.get.mock.calls
      .filter(([path]) => String(path).endsWith("daily-usage"))
      .at(-1)![1];
    state.workspaceId = "workspace-b";
    await render();
    expect(old.signal.aborted).toBe(true);
    const current = state.get.mock.calls
      .filter(([path]) => String(path).endsWith("daily-usage"))
      .at(-1)![1];
    expect(current.headers["x-fizz-workspace-id"]).toBe("workspace-b");
    expect(current.params.projectId).toBeUndefined();
  });
  it("passes cancellation to project, member and job requests on unmount", async () => {
    state.projects.mockImplementation(() => new Promise(() => {}));
    state.members.mockImplementation(() => new Promise(() => {}));
    state.jobs.mockImplementation(() => new Promise(() => {}));
    await render();
    const projectSignal = state.projects.mock.calls[0][1];
    const memberSignal = state.members.mock.calls[0][1];
    const jobSignal = state.jobs.mock.calls[0][1].signal;
    await act(async () => root.render(null));
    expect(projectSignal.aborted).toBe(true);
    expect(memberSignal.aborted).toBe(true);
    expect(jobSignal.aborted).toBe(true);
  });
  it.each(["wallet-ledger", "daily-usage", "member-usage"])(
    "recovers %s without presenting a failed read as zero usage",
    async (endpoint) => {
      const original = state.get.getMockImplementation()!;
      let failed = true;
      state.get.mockImplementation((path: string, options: unknown) =>
        path.endsWith(endpoint) && failed
          ? Promise.reject(new Error("Usage service unavailable"))
          : original(path, options)
      );
      await render();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      expect(container.textContent).toContain("Usage service unavailable");
      if (endpoint === "wallet-ledger") expect(container.textContent).not.toContain("totalJobs");
      const button = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "retry"
      );
      expect(button).toBeTruthy();
      failed = false;
      await act(async () => button!.click());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      expect(container.textContent).not.toContain("Usage service unavailable");
    }
  );
});
