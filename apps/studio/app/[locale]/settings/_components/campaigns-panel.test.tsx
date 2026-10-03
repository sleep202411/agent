// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { CampaignsPanel } from "./campaigns-panel";
const state = vi.hoisted(() => ({
  id: "a",
  list: vi.fn(),
  claim: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.id }, isCurrentAccount: (id: string) => id === state.id }),
}));
vi.mock("@/app/_components/credits-badge", () => ({ computeWalletBalanceQueryKey: ["balance"] }));
vi.mock("@/lib/billing", () => ({ listActiveCampaigns: state.list, claimCampaign: state.claim }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
let root: Root, host: HTMLDivElement, client: QueryClient;
const offer = {
  id: "offer",
  name: "Welcome offer",
  description: null,
  computeCreditAmount: 100,
  claimed: false,
};
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};
const render = async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CampaignsPanel />
      </QueryClientProvider>
    )
  );
  await settle();
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  state.id = "a";
  state.list.mockResolvedValue({ items: [offer] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
it("shows a failed offer read and recovers on retry", async () => {
  state.list.mockRejectedValueOnce(new Error("Offers unavailable"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Offers unavailable");
  act(() => host.querySelector("button")!.click());
  await settle();
  expect(host.textContent).toContain(offer.name);
});
it("does not reuse another account's offers and aborts abandoned reads", async () => {
  state.list.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  const signal = state.list.mock.calls[0]![0] as AbortSignal;
  state.id = "b";
  await render();
  expect(signal.aborted).toBe(true);
  expect(state.list).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain(offer.name);
});
it("ignores a claim returned after account replacement and prevents concurrent claims", async () => {
  let resolve!: (v: unknown) => void;
  state.claim.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(state.claim).toHaveBeenCalledOnce();
  const signal = state.claim.mock.calls[0]![1] as AbortSignal;
  state.id = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ granted: { amount: "100" }, alreadyClaimed: false }));
  expect(state.success).not.toHaveBeenCalled();
});
it("refreshes the current account's claimed offer after success", async () => {
  state.claim.mockResolvedValue({ granted: { amount: "100" }, alreadyClaimed: false });
  await render();
  state.list.mockResolvedValue({ items: [{ ...offer, claimed: true }] });
  await act(async () => host.querySelector("button")!.click());
  await settle();
  expect(host.querySelector("button")!.disabled).toBe(true);
  expect(host.textContent).toContain("campaigns.claimed");
  expect(state.success).toHaveBeenCalledOnce();
});
