// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useStoryChapterWorkbench,
  storyChapterWorkbenchQueryKey,
} from "./use-story-chapter-workbench";
const state = vi.hoisted(() => ({ userId: "alice", chapter: "chapter", get: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock("@/lib/story-projects-api", () => ({ getStoryWorkbench: state.get }));
vi.mock("../_stores/story-project-ui-store", () => ({
  useStoryProjectUiStore: (select: (s: { activeChapterId: string }) => unknown) =>
    select({ activeChapterId: state.chapter }),
}));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
let client: QueryClient;
function View({ project }: { project: string }) {
  const query = useStoryChapterWorkbench(project);
  return <div>{query.data?.project.capabilities.join(",") ?? "pending"}</div>;
}
async function render(project = "project") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <View project={project} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.userId = "alice";
  state.chapter = "chapter";
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  client.clear();
  vi.resetAllMocks();
});
it("does not expose cached editing authority to a replacement account", async () => {
  state.get
    .mockResolvedValueOnce({ project: { workspaceId: "workspace", capabilities: ["story.edit"] } })
    .mockImplementationOnce(() => new Promise(() => {}));
  await render();
  expect(host.textContent).toContain("story.edit");
  state.userId = "bob";
  await render();
  expect(host.textContent).toBe("pending");
  expect(state.get).toHaveBeenCalledTimes(2);
  const signal = state.get.mock.calls[1]![2] as AbortSignal;
  state.userId = "";
  await render();
  expect(signal.aborted).toBe(true);
  expect(state.get).toHaveBeenCalledTimes(2);
});
it("cancels replaced chapter/project reads and rejects incomplete scope", async () => {
  state.get.mockImplementation(() => new Promise(() => {}));
  await render("");
  expect(state.get).not.toHaveBeenCalled();
  await render();
  const first = state.get.mock.calls[0]![2] as AbortSignal;
  state.chapter = "other";
  await render();
  expect(first.aborted).toBe(true);
  const second = state.get.mock.calls[1]![2] as AbortSignal;
  await render("other-project");
  expect(second.aborted).toBe(true);
  state.chapter = "";
  await render();
  expect(state.get).toHaveBeenCalledTimes(3);
});
it("keeps chapter invalidation compatible while updating only the owning account", async () => {
  const aliceKey = storyChapterWorkbenchQueryKey("project", "chapter", "alice");
  const bobKey = storyChapterWorkbenchQueryKey("project", "chapter", "bob");
  client.setQueryData(aliceKey, { revision: 1 });
  client.setQueryData(bobKey, { revision: 4 });
  client.setQueryData(aliceKey, { revision: 2 });
  expect(client.getQueryData(bobKey)).toEqual({ revision: 4 });
  await client.invalidateQueries({ queryKey: storyChapterWorkbenchQueryKey("project", "chapter") });
  expect(client.getQueryState(aliceKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(bobKey)?.isInvalidated).toBe(true);
});
