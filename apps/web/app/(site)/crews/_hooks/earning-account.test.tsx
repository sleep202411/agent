import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import { useCrewEarnings, useCrewEarningDetail, useApproveCrewEarning } from "./use-earnings";

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

it("hides earning lists and details on logout and while another account loads", async () => {
  vi.mocked(crewApi.get).mockImplementation(async (path) =>
    path.includes("crew-earnings")
      ? { id: "private-earning", events: [] }
      : { items: [{ id: "private-earning" }], nextCursor: null }
  );
  const view = mount(() => ({
    list: useCrewEarnings("crew-1", { scope: "mine", currency: "USD" }),
    detail: useCrewEarningDetail("private-earning"),
  }));
  await settle();
  expect(view.current().list.data).toHaveLength(1);
  expect(view.current().detail.data?.id).toBe("private-earning");
  session.id = null;
  view.render();
  expect(view.current().list.data).toEqual([]);
  expect(view.current().detail.data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(2);
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  session.id = "bob";
  view.render();
  expect(view.current().list.data).toEqual([]);
  expect(view.current().detail.data).toBeUndefined();
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(4);
});

it("applies a late earning result only to its originating account", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(crewApi.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const view = mount(() => useApproveCrewEarning("crew-1"));
  const alice = [...crewKeys.earning("earning-1"), "alice"];
  const bob = [...crewKeys.earning("earning-1"), "bob"];
  client.setQueryData(alice, { id: "earning-1", version: 1, events: [] });
  client.setQueryData(bob, { id: "earning-1", version: 1, events: [] });
  let request!: Promise<unknown>;
  await act(async () => {
    request = view.current().mutateAsync({ earningId: "earning-1", expectedVersion: 1 });
    await Promise.resolve();
  });
  session.id = "bob";
  view.render();
  await act(async () => {
    complete({ id: "earning-1", version: 2 });
    await request;
  });
  expect(client.getQueryData(alice)).toMatchObject({ version: 2 });
  expect(client.getQueryData(bob)).toMatchObject({ version: 1 });
  expect(client.getQueryState(bob)?.isInvalidated).toBe(false);
});

it("isolates optimistic decisions and failed-request recovery from another account", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(crewApi.post).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  const view = mount(() => useApproveCrewEarning("crew-1"));
  const alice = [...crewKeys.earnings("crew-1", "mine"), "all", "all", "USD", "alice"];
  const bob = [...crewKeys.earnings("crew-1", "mine"), "all", "all", "USD", "bob"];
  const page = {
    pages: [{ items: [{ id: "earning-1", status: "pending", version: 1 }], nextCursor: null }],
    pageParams: [undefined],
  };
  client.setQueryData(alice, page);
  client.setQueryData(bob, page);
  let request!: Promise<unknown>;
  await act(async () => {
    request = view
      .current()
      .mutateAsync({ earningId: "earning-1", expectedVersion: 1 })
      .catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(client.getQueryData(alice)).toMatchObject({ pages: [{ items: [{ status: "posted" }] }] });
  expect(client.getQueryData(bob)).toEqual(page);
  session.id = "bob";
  view.render();
  const bobUpdated = {
    ...page,
    pages: [{ items: [{ id: "earning-1", status: "posted", version: 5 }], nextCursor: null }],
  };
  client.setQueryData(bob, bobUpdated);
  await act(async () => {
    fail(new Error("Permission revoked"));
    await request;
  });
  expect(client.getQueryData(alice)).toEqual(page);
  expect(client.getQueryData(bob)).toEqual(bobUpdated);
  expect(client.getQueryState(bob)?.isInvalidated).toBe(false);
});
