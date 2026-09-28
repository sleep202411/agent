import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useMyIpCommerceIp,
  useMyIpCommerceOverview,
  useMyIpCommerceAssets,
  useMyIpAclGrants,
  useMyIpContributors,
  useIpCommerceWallet,
  useIpCommerceCollection,
  useIpAccess,
} from "./hooks";
const state = vi.hoisted(() => ({
  userId: "alice",
  reads: Object.fromEntries(
    [
      "getMyIpCommerceIp",
      "getMyIpCommerceOverview",
      "listMyIpCommerceIpAssets",
      "listMyIpAclGrants",
      "listIpCommerceContributors",
      "getIpCommerceWallet",
      "listIpCommerceCollection",
      "getIpAccess",
    ].map((name) => [name, vi.fn()])
  ),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock("./api", async (original) => ({ ...(await original<object>()), ...state.reads }));
let client: QueryClient;
const host = document.createElement("div");
let root = createRoot(host);
let data: unknown[] = [];
function View() {
  const a = useMyIpCommerceIp("ip");
  const b = useMyIpCommerceOverview("ip");
  const c = useMyIpCommerceAssets("ip");
  const d = useMyIpAclGrants("ip");
  const e = useMyIpContributors("ip");
  const f = useIpCommerceWallet();
  const g = useIpCommerceCollection();
  const h = useIpAccess("ip");
  useLayoutEffect(() => {
    data = [a.data, b.data, c.data, d.data, e.data, f.data, g.data, h.data];
  });
  return null;
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <View />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.userId = "alice";
  for (const read of Object.values(state.reads)) read.mockResolvedValue({ owner: "alice" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  client.clear();
  vi.resetAllMocks();
});
it("isolates private details, balances, permissions and access status across account replacement", async () => {
  await render();
  expect(data).toHaveLength(8);
  expect(data.every((value) => (value as { owner: string })?.owner === "alice")).toBe(true);
  for (const read of Object.values(state.reads))
    read.mockImplementationOnce(() => new Promise(() => {}));
  state.userId = "bob";
  await render();
  expect(data.every((value) => value === undefined)).toBe(true);
  const signals = Object.values(state.reads).map(
    (read) => read.mock.calls[1]!.at(-1) as AbortSignal
  );
  state.userId = "";
  await render();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  for (const [name, read] of Object.entries(state.reads))
    expect(read).toHaveBeenCalledTimes(name === "getIpAccess" ? 3 : 2);
});
it("allows guest access quotes without requesting private data", async () => {
  state.userId = "";
  await render();
  for (const [name, read] of Object.entries(state.reads))
    expect(read).toHaveBeenCalledTimes(name === "getIpAccess" ? 1 : 0);
});
