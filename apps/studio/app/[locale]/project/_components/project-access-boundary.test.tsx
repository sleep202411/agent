import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { ProjectAccessBoundary } from "./project-access-boundary";
const state = vi.hoisted(() => ({
  account: "alice" as string | null,
  loading: false,
  read: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: state.account ? { id: state.account } : null,
    loading: state.loading,
    signIn: state.signIn,
  }),
}));
vi.mock("@/lib/collab/projects-api", () => ({
  getProject: (...args: unknown[]) => state.read(...args),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
function Editor({ role }: { role?: string }) {
  const [draft, setDraft] = useState("");
  return (
    <button data-role={role} onClick={() => setDraft("Unsaved scene")}>
      {draft || "Canvas editor"}
    </button>
  );
}
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(state, { account: "alice", loading: false });
  state.read
    .mockReset()
    .mockResolvedValue({ id: "one", name: "Project", workspaceId: "workspace", role: "editor" });
  state.signIn.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
async function render(id = "one") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectAccessBoundary projectId={id}>
          {(project) => <Editor role={project.role} />}
        </ProjectAccessBoundary>
      </QueryClientProvider>
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 5)));
}
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
async function refresh() {
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["platform-project-access"] });
    await new Promise((r) => setTimeout(r, 5));
  });
}
it("waits for role resolution before mounting the editor", async () => {
  let resolve!: (value: unknown) => void;
  state.read.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  expect(button("Canvas editor")).toBeUndefined();
  await act(async () => resolve({ id: "one", role: "viewer" }));
  await render();
  expect(button("Canvas editor").dataset.role).toBe("viewer");
});
it("offers retry and return after a failed read", async () => {
  state.read.mockRejectedValueOnce(new Error("Project temporarily unavailable"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Project temporarily unavailable");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/projects");
  await act(async () => button("retry").click());
  await render();
  expect(button("Canvas editor")).toBeDefined();
});
it("does not grant editing when the response lacks a role", async () => {
  state.read.mockResolvedValue({ id: "one" });
  await render();
  expect(button("Canvas editor")).toBeUndefined();
  expect(button("retry")).toBeDefined();
});
it("keeps a draft during temporary refresh failure", async () => {
  await render();
  act(() => button("Canvas editor").click());
  state.read.mockRejectedValue(new Error("Refresh interrupted"));
  await refresh();
  expect(button("Unsaved scene")).toBeDefined();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Refresh interrupted");
});
it.each([401, 403, 404, 410])("removes the editor after HTTP %s", async (status) => {
  await render();
  state.read.mockRejectedValue(new ApiRequestError(status, "No access", status));
  await refresh();
  expect(button("Canvas editor")).toBeUndefined();
  expect(button("retry")).toBeDefined();
});
it("starts a fresh project session when the account changes", async () => {
  await render();
  act(() => button("Canvas editor").click());
  state.account = "bob";
  await render();
  expect(button("Unsaved scene")).toBeUndefined();
  expect(button("Canvas editor")).toBeDefined();
  expect(state.read).toHaveBeenCalledTimes(2);
});
it("starts a fresh session on project navigation", async () => {
  await render();
  act(() => button("Canvas editor").click());
  await render("two");
  expect(button("Unsaved scene")).toBeUndefined();
  expect(button("Canvas editor")).toBeDefined();
});
it("offers sign-in without requesting a project for guests", async () => {
  state.account = null;
  await render();
  expect(state.read).not.toHaveBeenCalled();
  act(() => button("signIn").click());
  expect(state.signIn).toHaveBeenCalledOnce();
});
