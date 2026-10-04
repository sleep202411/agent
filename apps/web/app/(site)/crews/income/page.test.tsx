import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CrewApiError } from "../_hooks/api";
vi.mock("../../referral/_components/referral-dashboard", () => ({
  ReferralDashboardPage: () => <p>Referral panel content</p>,
}));
vi.mock("../../profile/earnings/earnings-content", () => ({
  default: () => <p>Work earnings panel content</p>,
}));
vi.mock("./payout-history", () => ({
  PayoutHistory: ({ currency }: { currency: string }) => {
    state.payoutCurrency = currency;
    return null;
  },
}));
const state = vi.hoisted(() => ({
  user: { id: "alice" } as { id: string } | null,
  currency: "",
  payoutCurrency: "",
  locale: "en-US",
  feed: {} as Record<string, unknown>,
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.user, isLoading: false }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => state.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/region/cell", () => ({ CURRENT_CELL: "com" }));
vi.mock("../_hooks/use-earnings", () => ({
  useMyCrewEarnings: (currency: string) => {
    state.currency = currency;
    return state.feed;
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
beforeEach(() => {
  client = new QueryClient();
  state.user = { id: "alice" };
  state.locale = "en-US";
  state.feed = {
    data: {
      pages: [
        {
          items: [
            {
              id: "record-a",
              crewId: "crew-a",
              title: "Accepted animation",
              description: null,
              task: null,
              amountMinor: "100",
              currency: "USD",
              status: "posted",
              createdAt: "2026-09-01T00:00:00Z",
            },
          ],
          summary: {
            byStatus: {
              posted: { amountMinor: "90000" },
              pending: { amountMinor: "200" },
              rejected: { amountMinor: "0" },
              reversed: { amountMinor: "0" },
            },
          },
        },
      ],
    },
    isPending: false,
    isError: false,
    isFetching: false,
    hasNextPage: true,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
const render = () =>
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )
  );
it("uses full server totals, separates pending amounts and requests the next page", () => {
  render();
  expect(container.textContent).toContain("USD 900.00");
  expect(container.textContent).toContain("USD 2.00");
  expect(container.textContent).toContain("USD 1.00");
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "loadMore"
  )!;
  act(() => button.click());
  expect(state.feed.fetchNextPage).toHaveBeenCalledTimes(1);
});
it("retains loaded records and the specific refresh error with retry", () => {
  state.feed.isError = true;
  state.feed.error = new Error("Ledger temporarily unavailable");
  render();
  expect(container.textContent).toContain("Accepted animation");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Ledger temporarily unavailable"
  );
  act(() =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === "retry")!.click()
  );
  expect(state.feed.refetch).toHaveBeenCalledTimes(1);
});
it("hides cached private financial records on logout", () => {
  render();
  state.user = null;
  render();
  expect(container.textContent).not.toContain("Accepted animation");
  expect(container.textContent).not.toContain("900.00");
  expect(container.textContent).toContain("signInRequired");
});
it.each(["en-US", "zh-CN", "zh-HK"])(
  "keeps site currency fixed in %s without a picker",
  (locale) => {
    state.locale = locale;
    render();
    expect(container.querySelector('select, [role="combobox"]')).toBeNull();
    expect(state.currency).toBe("USD");
    expect(state.payoutCurrency).toBe("USD");
    expect(container.textContent).toContain("USD");
    act(() =>
      [...container.querySelectorAll("button")]
        .find((node) => node.textContent === "refresh")!
        .click()
    );
    expect(state.feed.refetch).toHaveBeenCalledTimes(1);
  }
);

it.each([true, false])("recovers a next-page earnings failure (invalid cursor: %s)", (invalid) => {
  state.feed.isError = true;
  state.feed.isFetchNextPageError = true;
  state.feed.error = invalid
    ? new CrewApiError(400, { code: "CREW_EARNING_CURSOR_INVALID" })
    : new Error("Temporary outage");
  render();
  expect(container.textContent).toContain("Accepted animation");
  act(() =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === "retry")!.click()
  );
  expect(state.feed.refetch).toHaveBeenCalledTimes(invalid ? 1 : 0);
  expect(state.feed.fetchNextPage).toHaveBeenCalledTimes(invalid ? 0 : 1);
});

it.each(["alice", null])(
  "shows account income sources outside Production navigation for user %s",
  (userId) => {
    state.user = userId ? { id: userId } : null;
    render();
    expect(container.querySelector('nav[aria-label="navigationLabel"]')).toBeNull();
    const sources = container.querySelector('nav[aria-label="incomeSources"]');
    expect(sources?.textContent).toContain("referralIncome");
    expect(sources?.textContent).toContain("workIncome");
    expect(sources?.querySelector("a")?.getAttribute("href")).toBe("#production-ledger");
    expect(container.querySelector('a[href="/en-US/crews"]')).not.toBeNull();
  }
);

it("opens income sources in a side panel and clears them when the account changes", () => {
  render();
  const source = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.querySelector("span")?.textContent === name
    )!;
  act(() => source("referralIncome").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Referral panel content"
  );
  state.user = { id: "bob" };
  render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  act(() => source("workIncome").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Work earnings panel content"
  );
  state.user = null;
  render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
