import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAllMyIpCommerceIps, usePublicCreatorIps } from "./hooks";
const state = vi.hoisted(() => ({ userId: "alice", mine: vi.fn(), publicList: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  listMyIpCommerceIps: state.mine,
  listPublicCreatorIps: state.publicList,
}));
let client: QueryClient;
const host = document.createElement("div");
let root = createRoot(host);
let inventory: ReturnType<typeof useAllMyIpCommerceIps>;
function View({ creator = "creator" }: { creator?: string }) {
  const mine = useAllMyIpCommerceIps();
  usePublicCreatorIps(creator);
  useLayoutEffect(() => {
    inventory = mine;
  });
  return null;
}
async function render(creator = "creator") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <View creator={creator} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.userId = "alice";
  state.mine.mockResolvedValue({ items: [{ id: "private" }], nextCursor: null });
  state.publicList.mockResolvedValue({ items: [], nextCursor: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  client.clear();
  vi.resetAllMocks();
});
it("isolates private cached IPs across accounts and stops requests after logout", async () => {
  await render();
  expect(inventory.data?.items).toEqual([{ id: "private" }]);
  state.mine.mockImplementationOnce(() => new Promise(() => {}));
  state.userId = "bob";
  await render();
  expect(inventory.data).toBeUndefined();
  expect(state.mine).toHaveBeenCalledTimes(2);
  const signal = state.mine.mock.calls[1]![1] as AbortSignal;
  state.userId = "";
  await render();
  expect(signal.aborted).toBe(true);
  expect(state.mine).toHaveBeenCalledTimes(2);
});
it("cancels public pagination when the creator changes", async () => {
  state.publicList.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  const signal = state.publicList.mock.calls[0]![2] as AbortSignal;
  await render("other");
  expect(signal.aborted).toBe(true);
  expect(state.publicList).toHaveBeenCalledTimes(2);
});
