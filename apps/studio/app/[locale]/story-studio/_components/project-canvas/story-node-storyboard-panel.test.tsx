import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryNodeStoryboardPanel } from "./story-node-storyboard-panel";

const h = vi.hoisted(() => ({
  account: "alice",
  chapter: "chapter",
  barrier: vi.fn(),
  push: vi.fn(),
  create: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: h.account } }),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("../../_stores/story-project-ui-store", () => ({
  useStoryProjectUiStore: (select: (state: unknown) => unknown) =>
    select({ activeChapterId: h.chapter, draftBarrier: h.barrier }),
}));
vi.mock("@/lib/story-projects-api", () => ({
  storyApiErrorMessage: (error: Error) => error.message,
}));
vi.mock("@/lib/story-production-api", () => ({
  storyProductionKeys: { storyboard: (...args: unknown[]) => ["storyboard", ...args] },
  getStoryStoryboard: async () => [],
}));
vi.mock("@/lib/collab/storyboard-children-api", () => ({
  listStoryboardChildren: async () => [
    { nodeId: "node", taskId: null },
    { nodeId: "other", taskId: null },
  ],
  createStoryboardChild: (...args: unknown[]) => h.create(...args),
}));
vi.mock("./storyboard-task-picker", () => ({ StoryboardTaskPicker: () => null }));
vi.mock("../story-clip-video-replace", () => ({ StoryClipVideoReplace: () => null }));
let host: HTMLDivElement, root: Root, client: QueryClient;
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  h.account = "alice";
  h.chapter = "chapter";
  h.barrier.mockResolvedValue(undefined);
  h.create.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(projectId = "project", nodeId = "node") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StoryNodeStoryboardPanel projectId={projectId} nodeId={nodeId} canEdit />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
const open = () => host.querySelector("section > button") as HTMLButtonElement;
const create = () =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === "createTask")!;
it.each(["node", "chapter", "project", "account", "close"])(
  "does not redirect an obsolete editor open after %s changes",
  async (change) => {
    const pending = deferred();
    h.barrier.mockReturnValueOnce(pending.promise);
    await render();
    await act(async () => {
      open().click();
      open().click();
    });
    expect(h.barrier).toHaveBeenCalledTimes(1);
    if (change === "account") h.account = "bob";
    if (change === "chapter") h.chapter = "chapter-2";
    if (change === "close") await act(async () => root.render(null));
    else {
      await render(
        change === "project" ? "project-2" : "project",
        change === "node" ? "other" : "node"
      );
      expect(open().disabled).toBe(false);
    }
    await act(async () => pending.resolve());
    expect(h.push).not.toHaveBeenCalled();
    if (change !== "close") {
      await act(async () => open().click());
      expect(h.push).toHaveBeenCalledTimes(1);
      expect(h.push.mock.calls[0][0]).toContain(change === "node" ? "node=other" : "node=node");
    }
  }
);
it("shows a current autosave error and allows retry", async () => {
  h.barrier.mockRejectedValueOnce(new Error("Save unavailable"));
  await render();
  await act(async () => open().click());
  expect(h.error).toHaveBeenCalledWith("Save unavailable");
  expect(open().disabled).toBe(false);
  await act(async () => open().click());
  expect(h.push).toHaveBeenCalledWith(
    "/story-studio/projects/project/edit?chapter=chapter&node=node"
  );
});
it("ignores an obsolete autosave error", async () => {
  const pending = deferred();
  h.barrier.mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => open().click());
  await render("project", "other");
  await act(async () => pending.reject(new Error("Old failure")));
  expect(h.error).not.toHaveBeenCalled();
  expect(open().disabled).toBe(false);
});
it("refreshes a completed task creation without showing stale feedback on another node", async () => {
  const pending = deferred();
  h.create.mockReturnValueOnce(pending.promise);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await render();
  await act(async () => {
    create().click();
    create().click();
  });
  expect(h.create).toHaveBeenCalledTimes(1);
  await render("project", "other");
  expect(create().disabled).toBe(false);
  await act(async () => pending.resolve());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["storyboard-children", "project"] });
  expect(h.success).not.toHaveBeenCalled();
});
