import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ExpenseReceipts } from "./expense-receipts";

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

vi.mock("./expense-receipts-api", () => ({
  fetchExpenseReceipts: h.detail,
  pickExpenseReceipt: h.sign,
  uploadExpenseReceipt: h.open,
}));
const id = "11111111-1111-4111-8111-111111111111",
  draft = "22222222-2222-4222-8222-222222222222";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;
const change = vi.fn(),
  busy = vi.fn();
const render = (selected: string[] = []) =>
  act(async () =>
    root.render(
      <ExpenseReceipts
        crewId="crew"
        draftId={draft}
        generation={1}
        selected={selected}
        disabled={false}
        onChange={change}
        onBusy={busy}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.detail.mockResolvedValue({ items: [{ id, name: "receipt.pdf" }], nextCursor: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("attaches an uploaded receipt without a storage operation", async () => {
  await render();
  await act(async () => button("crewExpenses.attachReceipt").click());
  expect(change).toHaveBeenCalledWith([id]);
  expect(h.open).not.toHaveBeenCalled();
});
it("removes only the draft reference", async () => {
  await render([id]);
  await act(async () => button("crewExpenses.removeReceipt").click());
  expect(change).toHaveBeenCalledWith([]);
  expect(h.open).not.toHaveBeenCalled();
});
it("blocks duplicate upload taps, attaches confirmed receipt and unlocks parent", async () => {
  h.sign.mockResolvedValue({ id });
  h.open.mockResolvedValue({ id, name: "receipt.pdf" });
  await render();
  await act(async () => {
    button("crewExpenses.uploadReceipt").click();
    button("crewExpenses.uploadReceipt").click();
  });
  expect(h.sign).toHaveBeenCalledTimes(1);
  expect(h.open).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledWith([id]);
  expect(busy).toHaveBeenLastCalledWith(false);
});
it("retries the same upload after failure without repicking", async () => {
  h.sign.mockResolvedValue({ id });
  h.open.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ id, name: "receipt.pdf" });
  await render();
  await act(async () => button("crewExpenses.uploadReceipt").click());
  expect(host.textContent).toContain("Offline");
  await act(async () => button("receiptUpload.retry").click());
  expect(h.sign).toHaveBeenCalledTimes(1);
  expect(h.open.mock.calls[0]![2]).toBe(h.open.mock.calls[1]![2]);
});
it("blocks extra attachments at the ten receipt limit", async () => {
  await render(Array.from({ length: 10 }, (_, i) => String(i)));
  expect(button("crewExpenses.attachReceipt").disabled).toBe(true);
  expect(button("crewExpenses.uploadReceipt").disabled).toBe(true);
});
it("does not attach stale upload completion", async () => {
  let resolve!: (v: unknown) => void;
  h.sign.mockResolvedValue({ id });
  h.open.mockImplementation(() => new Promise((r) => (resolve = r)));
  await render();
  await act(async () => button("crewExpenses.uploadReceipt").click());
  h.generation = 2;
  await act(async () => resolve({ id, name: "receipt.pdf" }));
  expect(change).not.toHaveBeenCalled();
});
