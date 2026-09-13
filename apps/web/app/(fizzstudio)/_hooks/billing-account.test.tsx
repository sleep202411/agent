import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useComputeWalletLedger, useCreateComputeTopup } from "./use-billing";

const session = vi.hoisted(() => ({ id: "alice" as string | null, read: vi.fn(), write: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
  userKeys: { info: ["user", "info"] },
}));
vi.mock("../_lib/billing-api", () => ({
  listComputeTopupPackages: vi.fn(),
  getComputeWalletLedger: session.read,
  createComputeTopup: session.write,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  root = createRoot(document.createElement("div"));
  let current!: {
    list: ReturnType<typeof useComputeWalletLedger>;
    submit: ReturnType<typeof useCreateComputeTopup>;
  };
  function Probe() {
    current = {
      list: useComputeWalletLedger(),
      submit: useCreateComputeTopup(),
    };
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
  return { render, current: () => current };
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
it("does not read private wallet ledger while signed out", async () => {
  session.id = null;
  const view = mount();
  await settle();
  expect(session.read).not.toHaveBeenCalled();
  expect(view.current().list.data).toBeUndefined();
});
it("hides the previous account's wallet ledger on switch and logout", async () => {
  session.read.mockImplementation(async () => ({
    accounts: [{ ownerId: session.id }],
    entries: [],
  }));
  const view = mount();
  await settle();
  expect(view.current().list.data?.accounts[0]?.ownerId).toBe("alice");
  session.id = "bob";
  view.render();
  expect(view.current().list.data).toBeUndefined();
  await settle();
  expect(view.current().list.data?.accounts[0]?.ownerId).toBe("bob");
  session.id = null;
  view.render();
  expect(view.current().list.data).toBeUndefined();
});
it("keeps delayed prior-account reads out of the new session", async () => {
  let finish!: (value: unknown) => void;
  session.read
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ accounts: [{ ownerId: "bob" }], entries: [] });
  const view = mount();
  session.id = "bob";
  view.render();
  await settle();
  await act(async () => finish({ accounts: [{ ownerId: "alice" }], entries: [] }));
  await settle();
  expect(view.current().list.data?.accounts[0]?.ownerId).toBe("bob");
});
it.each(["submit"] as const)(
  "keeps delayed %s refreshes tied to the initiating account",
  async (kind) => {
    session.read.mockResolvedValue({ accounts: [{ ownerId: "alice" }], entries: [] });
    let finish!: (value: unknown) => void;
    session.write.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = mount();
    await settle();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view
        .current()
        [
          kind
        ].mutateAsync({ priceId: "price-1", idempotencyKey: "purchase-1", successUrl: "https://test.invalid/success", backUrl: "https://test.invalid/back" });
    });
    session.id = "bob";
    view.render();
    await settle();
    session.read.mockClear();
    client.setQueryData(["user", "info"], { id: "bob" });
    await act(async () => {
      finish({ order: { status: "fulfilled" } });
      await pending;
    });
    await settle();
    expect(session.read).not.toHaveBeenCalled();
    expect(client.getQueryState(["user", "info"])?.isInvalidated).toBe(false);
    session.id = "alice";
    view.render();
    await settle();
    expect(session.read).toHaveBeenCalledTimes(1);
  }
);
