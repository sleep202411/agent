import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ExpenseSubmit } from "./expense-submit";

vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  detail: vi.fn(),
  sign: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./crew-agreements-api", async (original) => ({
  ...(await original<typeof import("./crew-agreements-api")>()),
  fetchCrewAgreements: h.detail,
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

vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("./expense-submit-api", async (original) => ({
  ...(await original<typeof import("./expense-submit-api")>()),
  submitExpense: h.sign,
}));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const record = {
  id,
  version: 2,
  crewId: "crew",
  claimantUserId: "user",
  definition: {
    category: "Travel",
    purpose: "Scouting",
    occurredOn: "2026-09-29",
    currency: "USD" as const,
    amountMinor: "12345",
    evidenceNote: "",
    receiptIds: [other],
  },
  createdAt: "2026-09-30T00:00:00Z",
  submissionStatus: null,
  submittedAt: null,
};

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;
const render = (row = record) =>
  act(async () =>
    root.render(<ExpenseSubmit record={row} userId="user" generation={1} onSaved={h.open} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function review() {
  await render();
  await act(async () => button("crewExpenses.submit").click());
}
it("shows saved terms before explicit submission", async () => {
  await review();
  expect(h.sign).not.toHaveBeenCalled();
  expect(host.textContent).toContain("123.45");
  expect(host.textContent).toContain("crewExpenses.revision 2");
  expect(host.textContent).toContain("crewExpenses.receipts · 1");
  await act(async () => {
    button("expenseSubmit.confirm").click();
    button("expenseSubmit.confirm").click();
  });
  expect(h.sign).toHaveBeenCalledTimes(1);
  expect(h.open).toHaveBeenCalledOnce();
});
it("retries the same revision after uncertainty", async () => {
  h.sign.mockRejectedValueOnce(new Error("Offline"));
  await review();
  await act(async () => button("expenseSubmit.confirm").click());
  const first = h.sign.mock.calls[0];
  expect(host.textContent).toContain("Offline");
  await act(async () => button("expenseSubmit.retry").click());
  expect(h.sign.mock.calls[1]).toEqual(first);
});
it("allows cancelling review without a request", async () => {
  await review();
  await act(async () => button("common.cancel").click());
  expect(button("crewExpenses.submit")).toBeDefined();
  expect(h.sign).not.toHaveBeenCalled();
});
it("shows guidance for incomplete drafts", async () => {
  await render({ ...record, definition: { ...record.definition, category: "" } });
  expect(host.textContent).toContain("expenseSubmit.incomplete");
  expect(button("crewExpenses.submit")).toBeUndefined();
});
it("suppresses callbacks after account switch", async () => {
  let resolve!: () => void;
  h.sign.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  await review();
  await act(async () => button("expenseSubmit.confirm").click());
  h.generation = 2;
  await act(async () => resolve());
  expect(h.open).not.toHaveBeenCalled();
});
