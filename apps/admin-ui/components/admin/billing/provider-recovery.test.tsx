// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingBindingsPanel } from "./bindings-panel";
import { BillingProvidersPanel } from "./providers-panel";
import { BillingReconciliationPanel } from "./reconciliation-panel";
import type { AdminBillingOverviewData } from "./types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const overview: AdminBillingOverviewData = {
  generatedAt: "2026-01-01",
  metrics: {
    activeCatalogItems: 0,
    activePrices: 0,
    activeProviderBindings: 1,
    incompleteProviderBindings: 0,
    pendingOrders: 0,
    fulfilledOrders7d: 0,
    failedOrders7d: 0,
    paymentFailures7d: 0,
    revenue7d: [],
  },
  providerBindings: [
    {
      id: "binding",
      provider: "airwallex",
      status: "active",
      providerProductId: "product",
      providerPriceId: "price",
    },
  ],
  walletAccounts: [],
  walletLedgerEntries: [],
  recentOrders: [],
};
const props = { siteLabel: "Test", databaseLabel: "Local" };
const panels = {
  bindings: () => (
    <BillingBindingsPanel {...props} initialOverview={overview} initialPromotions={null} />
  ),
  providers: () => <BillingProvidersPanel {...props} initialOverview={overview} />,
  reconciliation: () => <BillingReconciliationPanel {...props} initialReconciliationRuns={null} />,
};
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const response = (data: unknown) => ({
  ok: true,
  json: () => Promise.resolve({ code: 200, data }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(view: ReactNode, scope = "one") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={scope}>{view}</AdminSessionBoundary>)
  );
}
function refresh() {
  [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("刷新"))!.click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
for (const [name, panel] of Object.entries(panels)) {
  it(`${name}: cancels abandoned reads and ignores late errors`, async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    await render(panel());
    await act(async () => refresh());
    const signals = fetchMock.mock.calls.map((call) => call[1].signal as AbortSignal);
    await render(panel(), "two");
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => pending.reject(new Error("Old failure")));
    expect(container.textContent).not.toContain("Old failure");
  });
  it(`${name}: keeps failure retryable and clears it after successful reads`, async () => {
    fetchMock.mockRejectedValue(new Error("Read unavailable"));
    await render(panel());
    await act(async () => refresh());
    expect(container.textContent).toContain("Read unavailable");
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(response(url.includes("overview") ? overview : { items: [] }))
    );
    await act(async () => refresh());
    expect(container.textContent).not.toContain("Read unavailable");
  });
}
it("excludes duplicate binding synchronization and suppresses abandoned follow-up reads", async () => {
  const pending = deferred();
  fetchMock.mockReturnValue(pending.promise);
  await render(panels.bindings());
  const sync = container.querySelector<HTMLButtonElement>('[aria-label="同步供应商价格"]')!;
  await act(async () => {
    sync.click();
    sync.click();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(panels.bindings(), "two");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response({})));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("cancels unfinished binding companion reads when one fails", async () => {
  fetchMock.mockImplementation((url: string) =>
    url.includes("overview") ? Promise.reject(new Error("Overview failed")) : new Promise(() => {})
  );
  await render(panels.bindings());
  await act(async () => refresh());
  expect(fetchMock.mock.calls.every((call) => call[1].signal.aborted)).toBe(true);
  expect(container.textContent).toContain("Overview failed");
});
