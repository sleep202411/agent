import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useCrewTaskView, useCrewTaskOptions } from "./use-tasks";

const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("./api", () => ({ crewApi: { get: vi.fn(), post: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
function mount<T>(hook: () => T) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  container = document.createElement("div");
  root = createRoot(container);
  let result: T;
  function Probe() {
    result = hook();
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
  render();
  return { current: () => result!, render };
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  session.id = "alice";
  vi.resetAllMocks();
});

for (const kind of ["view", "options"] as const) {
  const useList =
    kind === "view"
      ? function useView() {
          return useCrewTaskView("crew", { viewId: "view" });
        }
      : function useOptions() {
          return useCrewTaskOptions("crew");
        };
  it(`${kind}: loads records beyond the first page and stops at the end`, async () => {
    vi.mocked(crewApi.get)
      .mockResolvedValueOnce({ items: [{ id: "first" }], nextCursor: "first" })
      .mockResolvedValue({ items: [{ id: "last" }], nextCursor: null });
    const view = mount(useList);
    await settle();
    await settle();
    await settle();
    expect(view.current().data.map((row) => row.id)).toEqual(["first", "last"]);
    expect(crewApi.get).toHaveBeenCalledTimes(2);
  });
  it(`${kind}: pauses failed continuation and rebuilds from the start on retry`, async () => {
    vi.mocked(crewApi.get)
      .mockResolvedValueOnce({ items: [{ id: "first" }], nextCursor: "first" })
      .mockRejectedValue(new Error("Page unavailable"));
    const view = mount(useList);
    await settle();
    await settle();
    await settle();
    expect(view.current().isError).toBe(true);
    expect(view.current().data.map((row) => row.id)).toEqual(["first"]);
    expect(crewApi.get).toHaveBeenCalledTimes(2);
    vi.mocked(crewApi.get).mockResolvedValue({ items: [{ id: "replacement" }], nextCursor: null });
    await act(async () => {
      await view.current().refetch();
    });
    await settle();
    expect(vi.mocked(crewApi.get).mock.calls[2][1]?.query?.cursor).toBeUndefined();
    expect(view.current().data.map((row) => row.id)).toEqual(["replacement"]);
  });
  it(`${kind}: cancels abandoned reads without exposing the old account's records`, async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(crewApi.get).mockImplementation((_url, options) => {
      signal = options?.signal ?? undefined;
      return new Promise(() => {});
    });
    const view = mount(useList);
    await settle();
    const old = signal;
    session.id = "bob";
    view.render();
    await settle();
    expect(old?.aborted).toBe(true);
    expect(view.current().data).toEqual([]);
  });
}

it("does not continue cached task pages while the task section is disabled", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({ items: [{ id: "first" }], nextCursor: "first" });
  let enabled = false;
  const view = mount(() => useCrewTaskView("crew", { viewId: "view" }, enabled));
  await act(async () => {
    client.setQueryData(client.getQueryCache().getAll()[0].queryKey, {
      pages: [{ items: [{ id: "first" }], nextCursor: "first" }],
      pageParams: [undefined],
    });
  });
  await settle();
  await settle();
  expect(view.current().hasNextPage).toBe(true);
  expect(crewApi.get).not.toHaveBeenCalled();
  vi.mocked(crewApi.get).mockResolvedValue({ items: [{ id: "last" }], nextCursor: null });
  enabled = true;
  view.render();
  await settle();
  await settle();
  expect(view.current().data.map((row) => row.id)).toEqual(["first", "last"]);
});

it("keeps recruitment filtering on every options page", async () => {
  vi.mocked(crewApi.get)
    .mockResolvedValueOnce({ items: [{ id: "first" }], nextCursor: "first" })
    .mockResolvedValue({ items: [{ id: "last" }], nextCursor: null });
  mount(() => useCrewTaskOptions("crew", { recruitmentOnly: true }));
  await settle();
  await settle();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(2);
  for (const [url, options] of vi.mocked(crewApi.get).mock.calls) {
    expect(url).toBe("/crews/crew/task-options");
    expect(options?.query?.recruitmentOnly).toBe("true");
  }
});
