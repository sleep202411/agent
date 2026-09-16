import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { CrewApiError } from "../_hooks/api";
vi.mock("./payout-history", () => ({ PayoutHistory: () => null }));
const state = vi.hoisted(() => ({
  user: { id: "alice" } as { id: string } | null,
  currency: "",
  feed: {} as Record<string, unknown>,
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.user, isLoading: false }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/region/cell", () => ({ CURRENT_CELL: "com" }));
vi.mock("../_hooks/use-earnings", () => ({
  useMyCrewEarnings: (currency: string) => {
    state.currency = currency;
    return state.feed;
  },
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({ onChange, ...props }: { onChange: (value: string) => void }) => (
    // eslint-disable-next-line no-restricted-syntax -- Test adapter for the production NativeSelect component.
    <select {...props} onChange={(event) => onChange(event.target.value)} />
  ),
  NativeSelectOption: (props: object) => <option {...props} />,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  state.user = { id: "alice" };
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
afterEach(() => act(() => root.unmount()));
const render = () => act(() => root.render(<Page />));
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
it("switches currencies without converting the amounts", () => {
  render();
  act(() => {
    const select = container.querySelector("select")!;
    select.value = "CNY";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(state.currency).toBe("CNY");
});

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
