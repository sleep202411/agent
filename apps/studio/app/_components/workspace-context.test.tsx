// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("./auth-provider", () => ({
  useAuth: () => ({ user: { id: "local-user" }, loading: false }),
}));
vi.mock("@/lib/api", () => ({ setApiWorkspaceId: vi.fn() }));
vi.mock("@/lib/collab/projects-api", () => ({
  ensurePersonalWorkspace: vi.fn().mockResolvedValue(undefined),
  listWorkspaces: vi.fn().mockResolvedValue([
    { id: "personal", type: "personal", role: "owner", name: "Personal" },
    { id: "team", type: "team", role: "editor", name: "Team" },
  ]),
  createTeamWorkspace: vi.fn(),
}));
import { WorkspaceProvider, useWorkspace, ACTIVE_WORKSPACE_STORAGE_KEY } from "./workspace-context";

let root: Root, container: HTMLDivElement, client: QueryClient;
function Selection() {
  const { activeWorkspace, setActiveWorkspaceId } = useWorkspace();
  return (
    <>
      <output>{activeWorkspace?.id ?? "none"}</output>
      <button onClick={() => setActiveWorkspaceId("personal")}>Switch</button>
    </>
  );
}
beforeEach(() => {
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
  it("selects the invited team instead of the previous personal workspace", async () => {
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
});
