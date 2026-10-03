// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const auth = vi.hoisted(() => ({ id: "local-user" }));
vi.mock("./auth-provider", () => ({
  useAuth: () => ({ user: { id: auth.id }, loading: false }),
}));
vi.mock("@/lib/api", () => ({ setApiWorkspaceId: vi.fn() }));
vi.mock("@/lib/collab/projects-api", () => ({
  ensureDefaultWorkspace: vi.fn().mockResolvedValue(undefined),
  listWorkspaces: vi.fn().mockResolvedValue([
    { id: "personal", isDefault: true, role: "owner", name: "Personal" },
    { id: "team", isDefault: false, role: "editor", name: "Team" },
  ]),
  createWorkspace: vi.fn(),
}));
import { WorkspaceProvider, useWorkspace, ACTIVE_WORKSPACE_STORAGE_KEY } from "./workspace-context";

import * as projects from "@/lib/collab/projects-api";
let context: ReturnType<typeof useWorkspace>;
let root: Root, container: HTMLDivElement, client: QueryClient;
function Selection() {
  const current = useWorkspace();
  useLayoutEffect(() => {
    context = current;
  }, [current]);
  const { activeWorkspace, setActiveWorkspaceId } = current;
  return (
    <>
      <output>{activeWorkspace?.id ?? "none"}</output>
      <button onClick={() => setActiveWorkspaceId("personal")}>Switch</button>
    </>
  );
}
beforeEach(() => {
  auth.id = "local-user";
  vi.mocked(projects.createWorkspace).mockReset();
  vi.mocked(projects.ensureDefaultWorkspace)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(projects.listWorkspaces).mockClear();
  localStorage.clear();
  localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "personal");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  window.history.replaceState(null, "", "/");
});
async function render(query: string) {
  window.history.replaceState(null, "", `/zh-CN/canvas${query}`);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <WorkspaceProvider>
          <Selection />
        </WorkspaceProvider>
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
describe("workspace links from notifications", () => {
  it("selects the invited team instead of the previous default workspace", async () => {
    await render("?ws=team");
    expect(container.querySelector("output")?.textContent).toBe("team");
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe("team");
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector("output")?.textContent).toBe("personal");
    expect(new URLSearchParams(window.location.search).get("ws")).toBe("personal");
  });
  it("does not substitute another team for an inaccessible explicit target", async () => {
    await render("?ws=removed-team");
    expect(container.querySelector("output")?.textContent).toBe("none");
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe("personal");
  });
  const created = { id: "created", name: "Created", isDefault: false, defaultProjectId: null };
  it("does not select a workspace returned to an abandoned account", async () => {
    await render("");
    let resolve!: (value: typeof created) => void;
    vi.mocked(projects.createWorkspace).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const pending = context.createWorkspace("Created");
    void pending.catch(() => undefined);
    auth.id = "replacement";
    await render("");
    resolve(created);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe("personal");
  });
  it("preserves a later selection while workspace creation is pending", async () => {
    await render("");
    let resolve!: (value: typeof created) => void;
    vi.mocked(projects.createWorkspace).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const pending = context.createWorkspace("Created");
    act(() => context.setActiveWorkspaceId("team"));
    await act(async () => {
      resolve(created);
      await pending;
    });
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe("team");
  });
  it("honors caller cancellation without selecting the created workspace", async () => {
    await render("");
    let resolve!: (value: typeof created) => void;
    vi.mocked(projects.createWorkspace).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const cancellation = new AbortController();
    const pending = context.createWorkspace("Created", undefined, undefined, cancellation.signal);
    void pending.catch(() => undefined);
    cancellation.abort();
    resolve(created);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.mocked(projects.createWorkspace).mock.calls[0][1]?.aborted).toBe(true);
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe("personal");
  });
  it("does not start a stale membership list after delayed default provisioning", async () => {
    let resolve!: () => void;
    vi.mocked(projects.ensureDefaultWorkspace).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = () => r(undefined as never);
        })
    );
    await render("");
    const signal = vi.mocked(projects.ensureDefaultWorkspace).mock.calls[0][0]!;
    auth.id = "replacement";
    await render("");
    await act(async () => resolve());
    expect(signal.aborted).toBe(true);
    expect(projects.listWorkspaces).toHaveBeenCalledTimes(1);
  });
});

it("exposes failed workspace reads and refresh recovers the list", async () => {
  vi.mocked(projects.ensureDefaultWorkspace).mockRejectedValueOnce(new Error("Workspace offline"));
  await render("");
  expect(context.loading).toBe(false);
  expect(context.error?.message).toBe("Workspace offline");
  expect(context.activeWorkspace).toBeNull();
  await act(async () => context.refresh());
  await render("");
  expect(context.error).toBeNull();
  expect(context.activeWorkspace?.id).toBe("personal");
});
