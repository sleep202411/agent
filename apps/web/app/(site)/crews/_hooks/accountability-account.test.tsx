import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  useAccountability,
  useAccountabilityAction,
  useTaskCommitments,
} from "./use-accountability";
const session = vi.hoisted(() => ({
  account: "alice" as string | null,
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.account ? { id: session.account } : null }),
}));
vi.mock("./api", () => ({ crewApi: { get: session.get, post: session.post } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
function mount<T>(hook: () => T) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  root = createRoot(document.createElement("div"));
  let result!: T;
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
  return { render, current: () => result };
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  session.account = "alice";
  vi.resetAllMocks();
});
it("isolates task and project records on account changes and stops fetching after logout", async () => {
  const view = mount(() => [useTaskCommitments("task"), useAccountability("crew", 1)]);
  for (const account of ["alice", "bob"]) {
    client.setQueryData(["crew", "commitments", "task", account], { records: [account] });
    client.setQueryData(["crew", "accountability", "crew", 1, account], {
      participants: [account],
    });
  }
  view.render();
  expect(view.current()[0]?.data).toEqual({ records: ["alice"] });
  session.account = "bob";
  view.render();
  expect(view.current()[0]?.data).toEqual({ records: ["bob"] });
  session.account = null;
  view.render();
  expect(view.current()[0]?.data).toBeUndefined();
  expect(session.get).not.toHaveBeenCalled();
});
it.each([false, true])(
  "refreshes only the originating account after a late mutation (failure=%s)",
  async (failure) => {
    const view = mount(useAccountabilityAction);
    const alice = ["crew", "accountability", "crew", 1, "alice"];
    const bob = ["crew", "accountability", "crew", 1, "bob"];
    client.setQueryData(alice, { participants: [] });
    client.setQueryData(bob, { participants: [] });
    let resolve!: (value: unknown) => void, reject!: (reason: Error) => void;
    session.post.mockReturnValue(
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      })
    );
    view.render();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view
        .current()
        .mutateAsync({ path: "/crews/crew/withdrawal", body: { reason: "Unavailable" } })
        .catch(() => undefined);
    });
    session.account = "bob";
    view.render();
    await act(async () => {
      if (failure) reject(new Error("Lost response"));
      else resolve({});
      await pending;
    });
    expect(client.getQueryState(alice)?.isInvalidated).toBe(true);
    expect(client.getQueryState(bob)?.isInvalidated).toBe(false);
  }
);

it("refreshes develop's existing task cache only while the initiating account is current", async () => {
  const view = mount(useAccountabilityAction);
  const taskKey = ["crew", "task", "task"];
  client.setQueryData(taskKey, { version: 1 });
  client.setQueryData(["user", "info"], { id: "alice" });
  session.post.mockResolvedValue({});
  view.render();
  await act(async () => {
    await view.current().mutateAsync({ path: "/crew-tasks/task/commitments" });
  });
  expect(client.getQueryState(taskKey)?.isInvalidated).toBe(true);
  client.setQueryData(taskKey, { version: 2 });
  client.setQueryData(["user", "info"], { id: "bob" });
  await act(async () => {
    await view.current().mutateAsync({ path: "/crew-tasks/task/commitments" });
  });
  expect(client.getQueryState(taskKey)?.isInvalidated).toBe(false);
});
