import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import EarningsPage from "./page";
import EarningsContent from "./earnings-content";
import { formatEarnings } from "./_hooks/use-earnings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  search: "",
  user: { id: "creator-one" },
  replace: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/src/lib/api", () => ({ api: { get: mocks.get } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: mocks.user, isFetched: true }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: mocks.open }),
}));
const entry = {
  id: "credit-one",
  kind: "ip",
  episodeId: "episode-one",
  workKey: "ip:one",
  workTitle: "The tower",
  contentTitle: "A locked door",
  amount: "30",
  sourceAmount: "50",
  orderNo: "purchase-one",
  transactionId: "transaction-one",
  status: "posted",
  createdAt: "2026-09-10T12:00:00Z",
};
const response = {
  lifetimeEarned: "30",
  withdrawableBalance: "30",
  works: [],
  entries: [entry],
  nextCursor: null,
};
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
let root: Root, container: HTMLDivElement, client: QueryClient;
async function render(embedded = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {embedded ? <EarningsContent embedded /> : <EarningsPage />}
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.search = "";
  mocks.user = { id: "creator-one" };
  mocks.get.mockResolvedValue(response);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  if (originalScroll)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

it("opens a credited transaction with separate sale and personal earnings, using only a read request", async () => {
  await render();
  const row = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("The tower")
  );
  expect(row).toBeTruthy();
  await act(async () => row!.click());
  const drawer = document.querySelector('[role="dialog"]');
  expect(drawer?.textContent).toContain("purchase-one");
  expect(drawer?.textContent).toContain("transaction-one");
  expect(drawer?.textContent).toContain("50 unit");
  expect(drawer?.textContent).toContain("+30");
  expect(mocks.get).toHaveBeenCalledTimes(1);
});
it("keeps backend errors visible and does not report a failed lookup as zero earnings", async () => {
  mocks.get.mockRejectedValue(new Error("Ledger is temporarily unavailable"));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Ledger is temporarily unavailable"
  );
  expect(container.textContent).not.toContain("emptyTitle");
  expect(container.textContent).toContain("—");
});
it("does not reuse another signed-in creator's income or open details", async () => {
  await render();
  const row = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("The tower")
  );
  await act(async () => row!.click());
  mocks.user = { id: "creator-two" };
  mocks.get.mockResolvedValue({
    ...response,
    lifetimeEarned: "0",
    withdrawableBalance: "0",
    entries: [],
  });
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain("The tower");
  expect(container.textContent).toContain("emptyTitle");
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
it("formats large point balances without losing integer precision", () => {
  expect(formatEarnings("9007199254740993", "en-US")).toBe("9,007,199,254,740,993");
});

async function clickPage(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
const secondPage = {
  ...response,
  entries: [{ ...entry, id: "credit-two", workTitle: "The return" }],
};
it("replaces rows when paging, reuses previous pages, and resets after changing filters", async () => {
  mocks.get
    .mockResolvedValueOnce({ ...response, nextCursor: "credit-one" })
    .mockResolvedValueOnce(secondPage);
  await render();
  await clickPage("pagination.next");
  expect(container.textContent).toContain("The return");
  expect(container.textContent).not.toContain("The tower");
  expect(mocks.get).toHaveBeenLastCalledWith(
    expect.stringContaining("limit=10&cursor=credit-one"),
    { cache: "no-store" }
  );
  const next = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "pagination.next"
  );
  expect(next?.disabled).toBe(true);
  await clickPage("pagination.previous");
  expect(container.textContent).toContain("The tower");
  await clickPage("pagination.next");
  expect(mocks.get).toHaveBeenCalledTimes(2);
  mocks.search = "days=30";
  mocks.get.mockResolvedValue(response);
  await render();
  expect(container.textContent).toContain("The tower");
  expect(container.textContent).not.toContain("The return");
  const previous = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "pagination.previous"
  );
  expect(previous?.disabled).toBe(true);
});
it("keeps the current page on fetch failure and advances after a successful retry", async () => {
  mocks.get
    .mockResolvedValueOnce({ ...response, nextCursor: "credit-one" })
    .mockRejectedValueOnce(new Error("Page unavailable"))
    .mockResolvedValueOnce(secondPage);
  await render();
  await clickPage("pagination.next");
  expect(container.textContent).toContain("The tower");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Page unavailable");
  await clickPage("retry");
  expect(container.textContent).toContain("The return");
  expect(container.textContent).not.toContain("The tower");
});

it("clears embedded income filters without leaving the Crew income panel", async () => {
  mocks.get.mockResolvedValue({ ...response, entries: [] });
  await render(true);
  const trigger = container.querySelector('[aria-label="timeFilter"]');
  await act(async () => {
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (item) => item.textContent === "period.30"
  );
  expect(option).toBeTruthy();
  await act(async () => (option as HTMLElement).click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(container.textContent).toContain("noMatches");
  await clickPage("clearFilters");
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(container.textContent).toContain("emptyTitle");
  expect(container.textContent).not.toContain("noMatches");
});
