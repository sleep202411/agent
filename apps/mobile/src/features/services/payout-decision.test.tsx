import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PayoutDecision } from "./payout-decision";
import type { DecisionPayout } from "./payout-decision-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), decide: vi.fn(), saved: vi.fn() }));
vi.mock("./payout-decision-api", async (original) => ({
  ...(await original<typeof import("./payout-decision-api")>()),
  fetchPayoutDecisionAccess: h.access,
  decidePayout: h.decide,
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
const record: DecisionPayout = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  userId: "recipient",
  currency: "USD",
  amountMinor: "1000",
  netAmountMinor: "800",
  withholdingAmountMinor: "200",
  note: null,
  createdAt: "2026-09-29T00:00:00Z",
  status: "pending",
  version: 2,
};
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = (row = record) =>
  act(async () =>
    root.render(<PayoutDecision record={row} userId="manager" generation={1} onSaved={h.saved} />)
  );
const click = (name: string) => act(async () => button(name).click());
async function enter(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires payment reference and explicit confirmation, and submits once", async () => {
  h.decide.mockResolvedValue({});
  await render();
  await click("crewFinance.payout_pay");
  expect(host.textContent).toContain("crewFinance.recordPaymentHelp");
  expect(button("crewFinance.confirmDecision").disabled).toBe(true);
  await enter("crewFinance.reference", "bank ref");
  await click("crewFinance.method_alipay");
  expect(h.decide).not.toHaveBeenCalled();
  await act(async () => {
    button("crewFinance.confirmDecision").click();
    button("crewFinance.confirmDecision").click();
  });
  expect(h.decide).toHaveBeenCalledExactlyOnceWith(
    record,
    { action: "pay", paymentMethod: "alipay", paymentReference: "bank ref" },
    "manager",
    1
  );
  expect(h.saved).toHaveBeenCalledOnce();
});
it("requires a void reason and shows server failure without retrying", async () => {
  h.decide.mockRejectedValue(new Error("Already paid"));
  await render();
  await click("crewFinance.payout_void");
  expect(button("crewFinance.confirmDecision").disabled).toBe(true);
  await enter("crewFinance.decisionReason", "Duplicate");
  await click("crewFinance.confirmDecision");
  expect(host.textContent).toContain("Already paid");
  expect(button("crewFinance.confirmDecision").disabled).toBe(true);
  expect(h.saved).not.toHaveBeenCalled();
});
it("hides actions from unauthorized users and for settled payouts", async () => {
  h.access.mockResolvedValue(false);
  await render();
  expect(button("crewFinance.payout_pay")).toBeUndefined();
  h.access.mockResolvedValue(true);
  await render({ ...record, status: "paid" });
  expect(button("crewFinance.payout_void")).toBeUndefined();
});
it("blocks stale-account submission", async () => {
  await render();
  await click("crewFinance.payout_void");
  await enter("crewFinance.decisionReason", "Duplicate");
  h.generation = 2;
  await click("crewFinance.confirmDecision");
  expect(h.decide).not.toHaveBeenCalled();
});
it("rejects unsafe proof URLs and cancels without writing", async () => {
  await render();
  await click("crewFinance.payout_pay");
  await enter("crewFinance.reference", "bank ref");
  await enter("crewFinance.proofUrl", "javascript:alert(1)");
  expect(button("crewFinance.confirmDecision").disabled).toBe(true);
  await click("episodeOrganization.cancel");
  expect(h.decide).not.toHaveBeenCalled();
});

it("recovers failed permission checks without recording a payment", async () => {
  h.access.mockRejectedValueOnce(new Error("Permission lookup failed"));
  await render();
  expect(host.textContent).toContain("Permission lookup failed");
  expect(button("crewFinance.payout_pay")).toBeUndefined();
  await click("common.retry");
  expect(host.textContent).not.toContain("Permission lookup failed");
  expect(button("crewFinance.payout_pay")).toBeDefined();
  expect(h.decide).not.toHaveBeenCalled();
});
it("clears payment evidence and confirmation when the payout changes", async () => {
  await render();
  await click("crewFinance.payout_pay");
  await enter("crewFinance.reference", "previous bank ref");
  await render({ ...record, id: "22222222-2222-4222-8222-222222222222" });
  expect(button("crewFinance.confirmDecision")).toBeUndefined();
  await click("crewFinance.payout_pay");
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="crewFinance.reference"]')!.value
  ).toBe("");
  expect(button("crewFinance.confirmDecision").disabled).toBe(true);
  expect(h.decide).not.toHaveBeenCalled();
});
it("resets an attempted decision after a refreshed record version", async () => {
  h.decide.mockRejectedValue(new Error("Version conflict"));
  await render();
  await click("crewFinance.payout_void");
  await enter("crewFinance.decisionReason", "Duplicate");
  await click("crewFinance.confirmDecision");
  await render({ ...record, version: 3 });
  expect(host.textContent).not.toContain("Version conflict");
  expect(button("crewFinance.confirmDecision")).toBeUndefined();
  expect(button("crewFinance.payout_void")).toBeDefined();
  expect(h.decide).toHaveBeenCalledTimes(1);
});
it("ignores old access after switching to another account", async () => {
  let resolve!: (value: boolean) => void;
  h.access.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  h.access.mockResolvedValue(false);
  await act(async () =>
    root.render(<PayoutDecision record={record} userId="viewer" generation={1} onSaved={h.saved} />)
  );
  await act(async () => resolve(true));
  expect(button("crewFinance.payout_pay")).toBeUndefined();
  expect(h.decide).not.toHaveBeenCalled();
});
