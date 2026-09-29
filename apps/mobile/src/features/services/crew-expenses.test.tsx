import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewExpenses } from "./crew-expenses";

vi.mock("./expense-edit", () => ({ ExpenseEdit: () => <span>expense edit form</span> }));
vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  detail: vi.fn(),
  sign: vi.fn(),
  open: vi.fn(),
  link: vi.fn(),
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
  Linking: { openURL: h.link },
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
vi.mock("./crew-expenses-api", () => ({
  fetchExpenses: h.detail,
  fetchExpenseHistory: h.sign,
  fetchExpenseReceipt: h.open,
}));
const id = "11111111-1111-4111-8111-111111111111",
  next = "22222222-2222-4222-8222-222222222222";
const row = {
  id,
  version: 2,
  crewId: "crew",
  claimantUserId: "user",
  definition: {
    category: "Travel",
    purpose: "Location scouting",
    occurredOn: "2026-09-29",
    currency: "USD",
    amountMinor: "12345",
    evidenceNote: "Train ticket",
    receiptIds: [next],
  },
  createdAt: "2026-09-30T00:00:00Z",
  submissionStatus: "pending",
  submittedAt: "2026-09-30T00:00:00Z",
};
const page = { items: [row], nextCursor: null };

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;
const render = () =>
  act(async () =>
    root.render(<CrewExpenses crewId="crew" userId="user" generation={1} onClose={h.close} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.detail.mockResolvedValue(page);
  h.sign.mockResolvedValue(page);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("shows claim details and opens saved history", async () => {
  await render();
  expect(host.textContent).toContain("Location scouting");
  expect(host.textContent).toContain("123.45");
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => button("crewExpenses.history").click());
  expect(h.sign).toHaveBeenCalledWith("crew", "user", id, null, expect.any(AbortSignal));
  expect(host.textContent).toContain("crewExpenses.revision 2");
});
it("clears records on history access failure", async () => {
  h.sign.mockRejectedValue(new Error("Forbidden"));
  await render();
  await act(async () => button("crewExpenses.history").click());
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("Train ticket");
});
it("paginates claims once per tap and rejects duplicate records", async () => {
  h.detail.mockResolvedValueOnce({ ...page, nextCursor: next }).mockResolvedValueOnce(page);
  await render();
  await act(async () => {
    button("crewExpenses.more").click();
    button("crewExpenses.more").click();
  });
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("pagination changed");
  expect(host.textContent).not.toContain("Location scouting");
});
it("does not display a stale account response", async () => {
  let resolve!: (v: unknown) => void;
  h.detail.mockImplementation(() => new Promise((r) => (resolve = r)));
  await render();
  h.generation = 2;
  await act(async () => resolve(page));
  expect(host.textContent).not.toContain("Location scouting");
});
it("loads older revisions", async () => {
  h.sign
    .mockResolvedValueOnce({ ...page, nextCursor: 2 })
    .mockResolvedValueOnce({ items: [{ ...row, version: 1 }], nextCursor: null });
  await render();
  await act(async () => button("crewExpenses.history").click());
  await act(async () => button("crewExpenses.more").click());
  expect(h.sign).toHaveBeenLastCalledWith("crew", "user", id, 2, expect.any(AbortSignal));
  expect(host.textContent).toContain("crewExpenses.revision 1");
});

it("opens receipts only on tap and prevents duplicate access", async () => {
  h.open.mockResolvedValue("https://storage.example.com/receipt");
  await render();
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => {
    button("crewExpenses.openReceipt").click();
    button("crewExpenses.openReceipt").click();
  });
  expect(h.open).toHaveBeenCalledTimes(1);
  expect(h.link).toHaveBeenCalledExactlyOnceWith("https://storage.example.com/receipt");
});
it("does not open a receipt after account changes", async () => {
  let resolve!: (v: string) => void;
  h.open.mockImplementation(() => new Promise<string>((r) => (resolve = r)));
  await render();
  await act(async () => button("crewExpenses.openReceipt").click());
  h.generation = 2;
  await act(async () => resolve("https://storage.example.com/receipt"));
  expect(h.link).not.toHaveBeenCalled();
});
it("opens new draft creation and hides edit for pending claims", async () => {
  await render();
  expect(button("mobileExpenses.edit")).toBeUndefined();
  await act(async () => button("crewExpenses.new").click());
  expect(host.textContent).toContain("expense edit form");
});
it("opens editing for a saved non-pending claim", async () => {
  h.detail.mockResolvedValue({ ...page, items: [{ ...row, submissionStatus: null }] });
  await render();
  await act(async () => button("mobileExpenses.edit").click());
  expect(host.textContent).toContain("expense edit form");
});
