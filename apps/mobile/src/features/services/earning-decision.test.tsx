import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { EarningDecision } from "./earning-decision";
import type { DecisionEarning } from "./earning-decision-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), decide: vi.fn(), saved: vi.fn() }));
vi.mock("./earning-decision-api", () => ({
  fetchEarningDecisionAccess: h.access,
  decideEarning: h.decide,
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
const record: DecisionEarning = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  userId: "recipient",
  currency: "USD",
  amountMinor: "100",
  createdAt: "2026-09-29T00:00:00Z",
  title: "Bonus",
  description: null,
  sourceType: "milestone_bonus",
  status: "pending",
  version: 2,
};
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = (row = record) =>
  act(async () =>
    root.render(<EarningDecision record={row} userId="manager" generation={1} onSaved={h.saved} />)
  );
const click = (name: string) => act(async () => button(name).click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ approve: true, reverse: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires confirmation and sends once on duplicate taps", async () => {
  h.decide.mockResolvedValue({});
  await render();
  await click("crewFinance.decision_approve");
  expect(h.decide).not.toHaveBeenCalled();
  await act(async () => {
    button("crewFinance.confirmDecision").click();
    button("crewFinance.confirmDecision").click();
  });
  expect(h.decide).toHaveBeenCalledExactlyOnceWith(record, "approve", "", "manager", 1);
  expect(h.saved).toHaveBeenCalledOnce();
});
it("requires a rejection reason and supports cancelling without a mutation", async () => {
  await render();
  await click("crewFinance.decision_reject");
  expect(button("crewFinance.confirmDecision").disabled).toBe(true);
  await click("episodeOrganization.cancel");
  expect(h.decide).not.toHaveBeenCalled();
});
it("hides actions from ledger-only viewers and uses separate reversal permission", async () => {
  h.access.mockResolvedValue({ approve: false, reverse: true });
  await render({ ...record, status: "posted" });
  expect(button("crewFinance.decision_approve")).toBeUndefined();
  expect(button("crewFinance.decision_reverse")).toBeDefined();
});
it("locks the decision after a conflict until the parent refreshes", async () => {
  h.decide.mockRejectedValue(new Error("Version conflict"));
  await render();
  await click("crewFinance.decision_approve");
  await click("crewFinance.confirmDecision");
  expect(host.textContent).toContain("Version conflict");
  expect(button("crewFinance.confirmDecision").disabled).toBe(true);
  expect(h.saved).not.toHaveBeenCalled();
});
it("blocks confirmation after an account switch", async () => {
  await render();
  await click("crewFinance.decision_approve");
  h.generation = 2;
  await click("crewFinance.confirmDecision");
  expect(h.decide).not.toHaveBeenCalled();
});
it("sends the reason captured from the native form", async () => {
  h.decide.mockResolvedValue({});
  await render();
  await click("crewFinance.decision_reject");
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Wrong milestone"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("crewFinance.confirmDecision");
  expect(h.decide).toHaveBeenCalledExactlyOnceWith(
    record,
    "reject",
    "Wrong milestone",
    "manager",
    1
  );
});
