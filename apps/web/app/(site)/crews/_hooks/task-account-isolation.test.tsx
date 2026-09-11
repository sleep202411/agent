import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import * as hooks from "./use-tasks";
import type { CrewTaskDTO, CrewTaskPageDTO, CrewTaskWorkflowStateDTO } from "./types";
import type { InfiniteData } from "@tanstack/react-query";
import { crewKeys } from "./shared";
const session = vi.hoisted(() => ({
  account: "alice" as string | null,
  crew: "crew-a",
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.account ? { id: session.account } : null }),
}));
vi.mock("./api", () => ({ crewApi: session.api }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
function mount<T>(useHook: () => T) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  root = createRoot(document.createElement("div"));
  let result!: T;
  function Probe() {
    result = useHook();
    return null;
  }
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
  return { render, current: () => result };
}
function keys(account: string, crew = "crew-a") {
  return [
    [...crewKeys.taskProject(crew), account],
    [...crewKeys.taskView(crew, { viewId: "view" }), account],
    [...crewKeys.taskOptions(crew, {}), account],
    [...crewKeys.taskSummary(crew), account],
    [...crewKeys.taskActivity(crew), account],
    [...crewKeys.task(crew), account],
    [...crewKeys.taskTimeline(crew), account],
    [...crewKeys.taskCenter, account, "all"],
    [...crewKeys.productionOverview(crew), account],
    [...crewKeys.episodes(crew), account],
    [...crewKeys.earnings(crew, "mine"), "all", "all", "USD", account],
  ];
}
function seed(account: string, crew = "crew-a") {
  const value = {
    id: crew,
    crewId: crew,
    title: account,
    pages: [{ items: [], nextCursor: null }],
    pageParams: [undefined],
  };
  for (const key of keys(account, crew)) client.setQueryData(key, value);
  return value;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  session.account = "alice";
  session.crew = "crew-a";
  vi.resetAllMocks();
});

it("isolates all task queries on account switch and stops private reads on logout", async () => {
  const view = mount(() => [
    hooks.useCrewTaskProject("crew-a"),
    hooks.useCrewTaskView("crew-a", { viewId: "view" }),
    hooks.useCrewTaskOptions("crew-a"),
    hooks.useCrewTaskSummary("crew-a"),
    hooks.useCrewTaskActivity("crew-a"),
    hooks.useCrewTask("crew-a"),
    hooks.useCrewTaskTimeline("crew-a"),
  ]);
  seed("alice");
  seed("bob");
  view.render();
  expect(JSON.stringify(view.current().map((q) => q.data))).toContain("alice");
  session.account = "bob";
  view.render();
  expect(JSON.stringify(view.current().map((q) => q.data))).not.toContain("alice");
  expect(JSON.stringify(view.current().map((q) => q.data))).toContain("bob");
  session.account = null;
  view.render();
  await settle();
  expect(JSON.stringify(view.current().map((q) => q.data))).not.toContain("bob");
  expect(session.api.get).not.toHaveBeenCalled();
});

const mutations = [
  hooks.useCreateCrewTaskView,
  hooks.useUpdateCrewTaskView,
  hooks.useDeleteCrewTaskView,
  hooks.useCreateCrewTaskWorkflowState,
  hooks.useUpdateCrewTaskWorkflowState,
  hooks.useReorderCrewTaskWorkflowStates,
  hooks.useDeleteCrewTaskWorkflowState,
  hooks.useCreateCrewTaskCycle,
  hooks.useUpdateCrewTaskCycle,
  hooks.useDeleteCrewTaskCycle,
  hooks.useCreateCrewTaskLabel,
  hooks.useUpdateCrewTaskLabel,
  hooks.useDeleteCrewTaskLabel,
  hooks.useCreateCrewTaskField,
  hooks.useUpdateCrewTaskField,
  hooks.useDeleteCrewTaskField,
  hooks.useReorderCrewTask,
  hooks.useBatchUpdateCrewTasks,
  hooks.useCreateCrewTask,
  hooks.useUpdateCrewTask,
  hooks.useDeleteCrewTask,
  function useCreateComment() {
    return hooks.useCreateCrewTaskComment(session.crew, session.crew);
  },
  hooks.useUpdateCrewTaskComment,
  hooks.useDeleteCrewTaskComment,
  hooks.useSubmitCrewTask,
  hooks.useReviewCrewTask,
];
it.each(mutations.map((useHook, i) => [useHook.name || `comment-${i}`, useHook] as const))(
  "keeps delayed %s results in their original account and Crew",
  async (_name, useHook) => {
    let resolve!: (value: unknown) => void;
    const request = new Promise((done) => {
      resolve = done;
    });
    for (const method of [session.api.post, session.api.patch, session.api.delete])
      method.mockReturnValue(request);
    const view = mount(() => useHook(session.crew));
    const original = seed("alice");
    seed("bob");
    seed("alice", "crew-b");
    seed("bob", "crew-b");
    view.render();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view
        .current()
        .mutateAsync({ taskId: "crew-a", input: {}, destinationState: { id: "state" } } as never);
    });
    session.account = "bob";
    session.crew = "crew-b";
    view.render();
    const confirmed = { ...original, title: "Confirmed" };
    await act(async () => {
      resolve(useHook === hooks.useBatchUpdateCrewTasks ? [confirmed] : confirmed);
      await pending;
    });
    for (const [account, crew] of [
      ["bob", "crew-a"],
      ["bob", "crew-b"],
      ["alice", "crew-b"],
    ]) {
      for (const key of keys(account!, crew!)) {
        if (account === "alice" && key[1] === "task-center") continue;
        expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
        expect(client.getQueryData(key)).toMatchObject({ title: account });
      }
    }
    expect(
      keys("alice").some(
        (key) =>
          client.getQueryState(key)?.isInvalidated ||
          (client.getQueryData(key) as { title?: string })?.title === "Confirmed"
      )
    ).toBe(true);
  }
);

it.each(["failure", "success"] as const)(
  "preserves newer task edits and added rows after reorder %s",
  async (outcome) => {
    let resolve!: (value: CrewTaskDTO) => void;
    let reject!: (error: Error) => void;
    session.api.post.mockReturnValue(
      new Promise<CrewTaskDTO>((done, fail) => {
        resolve = done;
        reject = fail;
      })
    );
    const view = mount(() => hooks.useReorderCrewTask("crew-a"));
    const destination = { id: "progress", semantic: "in_progress" } as CrewTaskWorkflowStateDTO;
    const original = {
      id: "task",
      crewId: "crew-a",
      title: "Original",
      version: 1,
      workflowStateId: "open",
      workflowState: { id: "open", semantic: "open" },
      status: "open",
      rank: "1024",
    } as CrewTaskDTO;
    const detailKey = [...crewKeys.task("task"), "alice"];
    const listKey = [...crewKeys.taskView("crew-a", { viewId: "view" }), "alice"];
    const page: InfiniteData<CrewTaskPageDTO> = {
      pages: [{ items: [original], nextCursor: null, total: 1, workflowCounts: { open: 1 } }],
      pageParams: [undefined],
    };
    client.setQueryData(detailKey, original);
    client.setQueryData(listKey, page);
    view.render();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view
        .current()
        .mutateAsync({
          taskId: "task",
          destinationState: destination,
          input: {
            expectedVersion: 1,
            workflowStateId: "progress",
            beforeTaskId: null,
            beforeTaskVersion: null,
            afterTaskId: null,
            afterTaskVersion: null,
          },
        })
        .catch((error: unknown) => error);
    });
    expect(client.getQueryData<CrewTaskDTO>(detailKey)?.status).toBe("in_progress");
    const newer = { ...original, title: "Collaborator edit", version: 5 };
    const added = { ...original, id: "new-task", title: "New task" };
    client.setQueryData(detailKey, newer);
    client.setQueryData(listKey, {
      ...page,
      pages: [{ ...page.pages[0], items: [newer, added], total: 2 }],
    });
    await act(async () => {
      if (outcome === "failure") reject(new Error("Reorder failed"));
      else resolve({ ...original, version: 2, title: "Earlier confirmed move" });
      await pending;
    });
    expect(client.getQueryData(detailKey)).toEqual(newer);
    expect(client.getQueryData<InfiniteData<CrewTaskPageDTO>>(listKey)?.pages[0]?.items).toEqual([
      newer,
      added,
    ]);
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  }
);

it("rolls back its own unchanged optimistic reorder after failure", async () => {
  let reject!: (error: Error) => void;
  session.api.post.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  const view = mount(() => hooks.useReorderCrewTask("crew-a"));
  const destination = { id: "progress", semantic: "in_progress" } as CrewTaskWorkflowStateDTO;
  const original = {
    id: "task",
    crewId: "crew-a",
    version: 1,
    status: "open",
    rank: "1024",
    workflowStateId: "open",
    workflowState: { id: "open", semantic: "open" },
  } as CrewTaskDTO;
  const detailKey = [...crewKeys.task("task"), "alice"];
  const listKey = [...crewKeys.taskView("crew-a", { viewId: "view" }), "alice"];
  const page: InfiniteData<CrewTaskPageDTO> = {
    pages: [{ items: [original], nextCursor: null, total: 1, workflowCounts: { open: 1 } }],
    pageParams: [undefined],
  };
  client.setQueryData(detailKey, original);
  client.setQueryData(listKey, page);
  view.render();
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = view
      .current()
      .mutateAsync({
        taskId: "task",
        destinationState: destination,
        input: {
          expectedVersion: 1,
          workflowStateId: "progress",
          beforeTaskId: null,
          beforeTaskVersion: null,
          afterTaskId: null,
          afterTaskVersion: null,
        },
      })
      .catch((error: unknown) => error);
  });
  expect(client.getQueryData<CrewTaskDTO>(detailKey)?.status).toBe("in_progress");
  await act(async () => {
    reject(new Error("Failed"));
    await pending;
  });
  expect(client.getQueryData(detailKey)).toEqual(original);
  expect(client.getQueryData(listKey)).toEqual(page);
});
