import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewFinanceDetail } from "./crew-finance-detail";
import type { FinanceRow } from "./crew-finance-api";
vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
const h = vi.hoisted(() => ({ generation: 1, detail: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock("./crew-finance-detail-api", async (original) => ({
  ...(await original<typeof import("./crew-finance-detail-api")>()),
  fetchFinanceDetail: h.detail,
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
  Linking: { openURL: h.open },
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
const row: FinanceRow = {
  id: "record",
  userId: "user",
  currency: "USD",
  amountMinor: "100",
  createdAt: "2026-09-29T00:00:00Z",
  status: "posted",
  title: "Reward",
  description: null,
};
const earning = {
  ...row,
  sourceType: "task_reward",
  task: null,
  agreement: null,
  rejectionReason: "Needs evidence",
  reversalReason: null,
  events: [
    { id: "event", actorUserId: "manager", action: "earning.rejected", createdAt: row.createdAt },
  ],
};
const render = () =>
  act(async () =>
    root.render(
      <CrewFinanceDetail
        crewId="crew"
        userId="user"
        onChanged={h.close}
        view="earnings"
        selected={row}
        generation={1}
        onClose={h.close}
      />
    )
  );
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.detail.mockResolvedValue(earning);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("renders reasons and translated audit actions", async () => {
  await render();
  expect(host.textContent).toContain("Needs evidence");
  expect(host.textContent).toContain("crewFinance.eventRejected");
  expect(host.textContent).toContain("manager");
});
it("hides stale financial details when refresh loses permission", async () => {
  await render();
  h.detail.mockRejectedValue(new Error("Forbidden"));
  await act(async () => button("thread.refresh").click());
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("Needs evidence");
});
it("ignores responses from an expired account session", async () => {
  let resolve!: (v: unknown) => void;
  h.detail.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => resolve(earning));
  expect(host.textContent).not.toContain("Needs evidence");
  await render();
  expect(host.textContent).toBe("");
});
it("shows allocations and opens payment proof only on an explicit tap", async () => {
  h.detail.mockResolvedValue({
    ...row,
    netAmountMinor: "80",
    withholdingAmountMinor: "20",
    note: "Invoice",
    paymentMethod: "bank_transfer",
    paymentReference: "wire123",
    paymentProofUrl: "https://example.com/proof",
    voidReason: null,
    allocations: [
      { id: "allocation", amountMinor: "100", earning: { title: "Allocated reward", task: null } },
    ],
    events: [],
  });
  h.open.mockResolvedValue(undefined);
  await render();
  expect(host.textContent).toContain("Allocated reward");
  expect(host.textContent).toContain("USD 0.80");
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => button("crewFinance.proof").click());
  expect(h.open).toHaveBeenCalledWith("https://example.com/proof");
});
