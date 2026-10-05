import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Page from "./page";
const h = vi.hoisted(() => ({ user: "alice", get: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: h.user }, isLoading: false }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: { id?: string }) =>
    values ? `${key} ${values.id}` : key,
}));
vi.mock("@/src/lib/region/cell", () => ({ CURRENT_CELL: "com" }));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: { get: (...args: unknown[]) => h.get(...args) },
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
const totals = {
  confirmedAmountMinor: "10000",
  reservedAmountMinor: "1000",
  paidAmountMinor: "2000",
  availableAmountMinor: "7000",
};
function response(path: string, options: { query: { crewId?: string; cursor?: string } }) {
  if (path === "/me/withdrawals/balances") return [];
  if (path === "/me/withdrawals") return { items: [], nextCursor: null };
  const crewId = options.query.crewId ?? "departed-crew";
  const amount = options.query.crewId ? "500" : "10000";
  const page = options.query.cursor ? "second" : "first";
  if (path === "/me/crew-earnings")
    return {
      items: [
        {
          id: page,
          crewId,
          title: `earning-${crewId}-${page}`,
          status: "posted",
          amountMinor: "500",
          currency: "USD",
          createdAt: "2026-09-25T00:00:00Z",
        },
      ],
      summary: {
        byStatus: Object.fromEntries(
          ["posted", "pending", "rejected", "reversed"].map((s) => [s, { amountMinor: amount }])
        ),
      },
      nextCursor: page === "first" ? `${crewId}-earning-cursor` : null,
    };
  return {
    items: [
      {
        id: page,
        crewId,
        status: "paid",
        amountMinor: "500",
        netAmountMinor: "450",
        withholdingAmountMinor: "50",
        currency: "USD",
        allocations: [],
      },
    ],
    summary: { ...totals, confirmedAmountMinor: amount, byStatus: [] },
    nextCursor: page === "first" ? `${crewId}-payout-cursor` : null,
  };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "alice";
  h.get.mockReset().mockImplementation((path, options) => Promise.resolve(response(path, options)));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )
  );
  await settle();
}
function buttons(key: string) {
  return [...container.querySelectorAll("button")].filter((b) => b.textContent === key);
}
async function click(key: string, index = 0) {
  expect(buttons(key)[index]).toBeDefined();
  await act(async () => buttons(key)[index]!.click());
  await settle();
}
it.each([0, 1])(
  "filters both feeds and balances from record action %s without membership reads",
  async (index) => {
    await render();
    await click("showCrew", index);
    expect(container.textContent).toContain("selectedCrew departed-crew");
    for (const path of ["/me/crew-earnings", "/me/crew-payouts"]) {
      expect(h.get).toHaveBeenCalledWith(
        path,
        expect.objectContaining({
          query: expect.objectContaining({ crewId: "departed-crew", cursor: undefined }),
          cache: "no-store",
        })
      );
    }
    expect(
      h.get.mock.calls.every(([path]) =>
        [
          "/me/crew-earnings",
          "/me/crew-payouts",
          "/me/withdrawals",
          "/me/withdrawals/balances",
        ].includes(path)
      )
    ).toBe(true);
    expect(container.textContent).not.toContain("USD 100.00");
    expect(container.textContent).toContain("USD 5.00");
  }
);
it("restarts both histories on filter and on returning to all Crews", async () => {
  await render();
  await click("loadMore");
  await click("more");
  expect(container.textContent).toContain("earning-departed-crew-second");
  await click("showCrew");
  expect(container.textContent).not.toContain("earning-departed-crew-second");
  await click("loadMore");
  await click("more");
  h.get.mockClear();
  await click("allCrews");
  expect(h.get.mock.calls).toHaveLength(2);
  for (const [, options] of h.get.mock.calls) {
    expect(options.query.cursor).toBeUndefined();
    expect(options.query.crewId).toBeUndefined();
  }
  expect(container.textContent).not.toContain("earning-departed-crew-second");
});
it("clears the Crew selection and private cache on account switching", async () => {
  await render();
  await click("showCrew");
  h.user = "bob";
  h.get.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(container.textContent).not.toContain("selectedCrew departed-crew");
  expect(container.textContent).not.toContain("earning-departed-crew-first");
  expect(container.textContent).not.toContain("USD 5.00");
});
it("aborts old reads when switching filters and does not flash the old totals", async () => {
  await render();
  h.get.mockImplementation(() => new Promise(() => {}));
  await click("showCrew");
  expect(container.textContent).not.toContain("USD 100.00");
  const oldSignals = h.get.mock.calls.slice(-2).map(([, options]) => options.signal);
  await click("allCrews");
  expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
});
it("empty personal results remain empty and can be reset without Crew access", async () => {
  await render();
  h.get.mockResolvedValue({
    items: [],
    nextCursor: null,
    summary: {
      ...totals,
      byStatus: {
        posted: { amountMinor: "0" },
        pending: { amountMinor: "0" },
        rejected: { amountMinor: "0" },
        reversed: { amountMinor: "0" },
      },
    },
  });
  // Payout summaries have their own byStatus array.
  h.get.mockImplementation((path) =>
    Promise.resolve({
      items: [],
      nextCursor: null,
      summary: path.endsWith("payouts")
        ? { ...totals, byStatus: [] }
        : {
            byStatus: Object.fromEntries(
              ["posted", "pending", "rejected", "reversed"].map((s) => [s, { amountMinor: "0" }])
            ),
          },
    })
  );
  await click("showCrew");
  expect(container.textContent).toContain("empty");
  expect(buttons("allCrews")).toHaveLength(1);
});

it("does not substitute combined balances when a filtered read fails and allows resetting", async () => {
  await render();
  h.get.mockRejectedValue(new Error("Filtered income unavailable"));
  await click("showCrew");
  expect(container.textContent).toContain("Filtered income unavailable");
  expect(container.textContent).not.toContain("USD 100.00");
  expect(container.textContent).not.toContain("earning-departed-crew-first");
  h.get.mockImplementation((path, options) => Promise.resolve(response(path, options)));
  await click("allCrews");
  expect(container.textContent).toContain("USD 100.00");
});

it("sends transaction filters to the server and starts a fresh cursor", async () => {
  await render();
  await click("loadMore");
  h.get.mockClear();
  const form = container.querySelector("form")!;
  const fields = {
    sourceType: "task_reward",
    status: "posted",
    recordedFrom: "2026-10-05",
    recordedThrough: "2026-10-07",
  };
  for (const [name, value] of Object.entries(fields)) {
    (form.elements.namedItem(name) as HTMLInputElement).value = value;
  }
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  await settle();
  const calls = h.get.mock.calls.filter(([path]) => path === "/me/crew-earnings");
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.at(-1)?.[1].query).toMatchObject({ ...fields, currency: "USD", cursor: undefined });
});
