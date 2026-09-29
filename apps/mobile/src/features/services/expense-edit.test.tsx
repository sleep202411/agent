import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ExpenseEdit } from "./expense-edit";

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
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("./expense-edit-api", async (original) => ({
  ...(await original<typeof import("./expense-edit-api")>()),
  saveExpense: h.sign,
}));
const id = "11111111-1111-4111-8111-111111111111",
  receipt = "22222222-2222-4222-8222-222222222222";
const definition = {
  category: "Travel",
  purpose: "Scouting",
  occurredOn: "2026-09-29",
  currency: "USD" as const,
  amountMinor: "12345",
  evidenceNote: "Train ticket",
  receiptIds: [receipt],
};
const row = {
  id,
  version: 2,
  crewId: "crew",
  claimantUserId: "user",
  definition,
  createdAt: "2026-09-30T00:00:00Z",
  submissionStatus: null,
  submittedAt: null,
};

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;
const render = (record: typeof row | undefined = row) =>
  act(async () =>
    root.render(
      <ExpenseEdit
        crewId="crew"
        userId="user"
        generation={1}
        record={record}
        onClose={h.close}
        onSaved={h.open}
      />
    )
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
async function enter(label: string, value: string) {
  await act(async () => {
    const node = host.querySelector(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("saves an edited revision retaining receipts and blocking duplicate taps", async () => {
  await render();
  await enter("crewExpenses.purpose", "New scouting");
  await act(async () => {
    button("crewExpenses.save").click();
    button("crewExpenses.save").click();
  });
  expect(h.sign).toHaveBeenCalledTimes(1);
  expect(h.sign).toHaveBeenCalledWith(
    "crew",
    "user",
    id,
    { expectedVersion: 2, definition: { ...definition, purpose: "New scouting" } },
    1
  );
  expect(h.open).toHaveBeenCalledOnce();
});
it("keeps terms and version frozen across uncertain retries", async () => {
  h.sign.mockRejectedValueOnce(new Error("Offline"));
  await render();
  await act(async () => button("crewExpenses.save").click());
  const first = h.sign.mock.calls[0];
  expect([...host.querySelectorAll("input")].every((n) => n.disabled)).toBe(true);
  await act(async () => button("mobileExpenses.retrySave").click());
  expect(h.sign.mock.calls[1]).toEqual(first);
});
it("allows fixing invalid amount before a save attempt", async () => {
  await render();
  await enter("crewExpenses.amount", "1.234");
  await act(async () => button("crewExpenses.save").click());
  expect(h.sign).not.toHaveBeenCalled();
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="crewExpenses.amount"]')!.disabled
  ).toBe(false);
});
it("requires explicit discard of changed fields", async () => {
  await render();
  await enter("crewExpenses.purpose", "Changed");
  await act(async () => button("mobileExpenses.backToClaims").click());
  expect(h.close).not.toHaveBeenCalled();
  await act(async () => button("crewExpenses.discard").click());
  expect(h.close).toHaveBeenCalledOnce();
});
it("suppresses stale account completion", async () => {
  let resolve!: () => void;
  h.sign.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  await render();
  await act(async () => button("crewExpenses.save").click());
  h.generation = 2;
  await act(async () => resolve());
  expect(h.open).not.toHaveBeenCalled();
});
it("creates a new incomplete draft at revision zero without submitting", async () => {
  await act(async () =>
    root.render(
      <ExpenseEdit crewId="crew" userId="user" generation={1} onClose={h.close} onSaved={h.open} />
    )
  );
  await enter("crewExpenses.category", "Travel");
  await act(async () => button("crewExpenses.save").click());
  expect(h.sign).toHaveBeenCalledWith(
    "crew",
    "user",
    id,
    {
      expectedVersion: 0,
      definition: {
        category: "Travel",
        purpose: "",
        occurredOn: null,
        currency: "USD",
        amountMinor: null,
        evidenceNote: "",
      },
    },
    1
  );
});
