import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PayoutHistory } from "./payout-history";
import { crewApi } from "../_hooks/api";
const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/region/cell", () => ({ CURRENT_CELL: "com" }));
vi.mock("../_hooks/api", () => ({ crewApi: { get: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  root = createRoot(container);
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <PayoutHistory currency="USD" />
        </QueryClientProvider>
      )
    );
  render();
  return render;
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
it("renders full net/gross totals and settlement references while retaining rows after refresh failure", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({
    items: [
      {
        id: "payout",
        crewId: "crew",
        currency: "USD",
        status: "paid",
        amountMinor: "100",
        netAmountMinor: "90",
        withholdingAmountMinor: "10",
        paymentReference: "BANK-REFERENCE",
        allocations: [],
      },
    ],
    nextCursor: null,
    summary: {
      byStatus: [{ status: "paid", count: 10, amountMinor: "1000", netAmountMinor: "900" }],
    },
  });
  mount();
  await settle();
  expect(container.textContent).toContain("USD 9.00");
  expect(container.textContent).toContain("USD 10.00");
  expect(container.textContent).toContain("BANK-REFERENCE");
  vi.mocked(crewApi.get).mockRejectedValue(new Error("Settlement read unavailable"));
  act(() => container.querySelector("button")!.click());
  await settle();
  expect(container.textContent).toContain("BANK-REFERENCE");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Settlement read unavailable"
  );
});
it("cancels the previous account's request and hides its records on account change and logout", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(crewApi.get).mockImplementation((_url, opts) => {
    signal = opts?.signal as AbortSignal;
    return new Promise(() => {});
  });
  const render = mount();
  await settle();
  const old = signal;
  session.id = "bob";
  render();
  await settle();
  expect(old?.aborted).toBe(true);
  const replacement = signal;
  session.id = null;
  render();
  await settle();
  expect(replacement?.aborted).toBe(true);
  expect(container.textContent).toBe("");
});
