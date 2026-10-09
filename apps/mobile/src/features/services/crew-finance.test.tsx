import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewFinance } from "./crew-finance";
vi.mock("./amendment-finance", () => ({
  AmendmentFinance: () => <span>amendment finance entry</span>,
}));
vi.mock("./crew-spend", () => ({ CrewSpendSummary: () => <span>spending summary screen</span> }));
vi.mock("./crew-expenses", () => ({ CrewExpenses: () => <span>expense history screen</span> }));
vi.mock("./crew-compute", () => ({ CrewCompute: () => <span>compute request screen</span> }));
vi.mock("./payout-create", () => ({ PayoutCreate: () => <span>payout creation entry</span> }));
vi.mock("./earning-create", () => ({ EarningCreate: () => <span>earning creation entry</span> }));
vi.mock("./crew-finance-trend", () => ({ CrewFinanceTrend: () => <span>income trend</span> }));
vi.mock("./crew-finance-detail", () => ({
  CrewFinanceDetail: () => <span>finance record detail</span>,
}));
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), page: vi.fn(), close: vi.fn() }));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("./crew-finance-api", async (original) => ({
  ...(await original<typeof import("./crew-finance-api")>()),
  fetchFinanceAccess: h.access,
  fetchFinancePage: h.page,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const first = {
  id: "one",
  userId: "user",
  currency: "USD",
  amountMinor: "101",
  createdAt: "2026-09-29T00:00:00Z",
  status: "posted",
  title: "Reward",
  description: null,
};
const page = { items: [first], nextCursor: null, summary: [{ label: "posted", amount: "101" }] };
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = () =>
  act(async () =>
    root.render(<CrewFinance crewId="crew" userId="user" generation={1} onClose={h.close} />)
  );
const click = (name: string) => act(async () => button(name).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue(false);
  h.page.mockResolvedValue(page);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("defaults to personal income and hides Crew scope without permission", async () => {
  await render();
  expect(button("crewFinance.crew")).toBeUndefined();
  expect(host.textContent).toContain("USD 1.01");
  expect(h.page.mock.calls[0]![2]).toMatchObject({
    view: "earnings",
    scope: "mine",
    currency: "USD",
  });
});
it("supports authorized Crew scope and resets incompatible filters on view change", async () => {
  h.access.mockResolvedValue(true);
  await render();
  await click("crewFinance.crew");
  expect(h.page.mock.lastCall![2].scope).toBe("crew");
  await click("crewFinance.posted");
  await click("crewFinance.payouts");
  expect(h.page.mock.lastCall![2]).toMatchObject({ view: "payouts", status: "all" });
});
it("loads another page once on repeated taps", async () => {
  h.page
    .mockResolvedValueOnce({ ...page, nextCursor: "cursor" })
    .mockResolvedValueOnce({ ...page, items: [{ ...first, id: "two", title: "Second" }] });
  await render();
  await act(async () => {
    button("crewFinance.more").click();
    button("crewFinance.more").click();
  });
  expect(h.page).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Second");
  expect(host.textContent).toContain("Reward");
});
it("rejects duplicate records across pages and requires refresh", async () => {
  h.page.mockResolvedValue({ ...page, nextCursor: "cursor" });
  await render();
  await click("crewFinance.more");
  expect(host.textContent).toContain("pagination changed");
  expect(button("crewFinance.more").disabled).toBe(true);
  await click("thread.refresh");
  expect(h.access).toHaveBeenCalledTimes(2);
});
it("rechecks permission on refresh and returns revoked Crew viewers to their own scope", async () => {
  h.access.mockResolvedValue(true);
  await render();
  await click("crewFinance.crew");
  h.access.mockResolvedValue(false);
  await click("thread.refresh");
  expect(h.page.mock.lastCall![2].scope).toBe("mine");
  expect(button("crewFinance.crew")).toBeUndefined();
});
it("ignores ledger responses after account changes", async () => {
  let resolve!: (value: unknown) => void;
  h.page.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => resolve(page));
  expect(host.textContent).not.toContain("Reward");
  await render();
  expect(host.textContent).toBe("");
});

it("shows the trend only for earnings", async () => {
  await render();
  expect(host.textContent).toContain("income trend");
  await click("crewFinance.payouts");
  expect(host.textContent).not.toContain("income trend");
});

it("opens a selected native financial record", async () => {
  await render();
  await click("Reward · crewFinance.details");
  expect(host.textContent).toContain("finance record detail");
});

it("shows the creation action for the selected ledger type", async () => {
  await render();
  expect(host.textContent).toContain("earning creation entry");
  expect(host.textContent).not.toContain("payout creation entry");
  await act(async () => button("crewFinance.payouts").click());
  expect(host.textContent).toContain("payout creation entry");
  expect(host.textContent).not.toContain("earning creation entry");
});
it("gates project spending entry on Crew ledger permission", async () => {
  await render();
  expect(button("crewSpend.heading")).toBeUndefined();
  h.access.mockResolvedValue(true);
  await click("thread.refresh");
  await click("crewSpend.heading");
  expect(host.textContent).toContain("spending summary screen");
});
