import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import { useCrewPayouts, useCrewPayoutDetail, usePayCrewPayout } from "./use-payouts";

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

it("hides payout lists and details on logout and while another account loads", async () => {
  vi.mocked(crewApi.get).mockImplementation(async (path) =>
    path.includes("crew-payouts")
      ? { id: "private-payout", events: [] }
      : { items: [{ id: "private-payout" }], nextCursor: null }
  );
  const view = mount(() => ({
    list: useCrewPayouts("crew-1", { scope: "mine", currency: "USD" }),
    detail: useCrewPayoutDetail("private-payout"),
  }));
  await settle();
  expect(view.current().list.data).toHaveLength(1);
  expect(view.current().detail.data?.id).toBe("private-payout");
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

it("applies a late payout result only to its originating account", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(crewApi.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const view = mount(() => usePayCrewPayout("crew-1"));
  const alice = [...crewKeys.payout("payout-1"), "alice"];
  const bob = [...crewKeys.payout("payout-1"), "bob"];
  client.setQueryData(alice, { id: "payout-1", version: 1, events: [] });
  client.setQueryData(bob, { id: "payout-1", version: 1, events: [] });
  let request!: Promise<unknown>;
  await act(async () => {
    request = view.current().mutateAsync({ payoutId: "payout-1", expectedVersion: 1 });
    await Promise.resolve();
  });
  session.id = "bob";
  view.render();
  await act(async () => {
    complete({ id: "payout-1", version: 2 });
    await request;
  });
  expect(client.getQueryData(alice)).toMatchObject({ version: 2 });
  expect(client.getQueryData(bob)).toMatchObject({ version: 1 });
  expect(client.getQueryState(bob)?.isInvalidated).toBe(false);
});
