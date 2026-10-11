import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreatorWithdrawals } from "./creator-withdrawals";
import { ApiRequestError } from "@/lib/api-client";
const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  open: vi.fn(),
  records: new Map<string, string>(),
  sequence: 0,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/config", () => ({ isChinaRegion: false }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/features/services/crew-finance-api", () => ({
  formatFinanceMoney: (value: string, currency: string) => `${currency} ${value}`,
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => `00000000-0000-4000-8000-${String(++h.sequence).padStart(12, "0")}` },
}));
vi.mock("./withdrawal-storage", () => ({
  withdrawalStorage: (user: string) => ({
    read: () => h.records.get(user) ?? null,
    write: (value: string) => {
      h.records.set(user, value);
    },
  }),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: number, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children, style }: { children: ReactNode; style?: { display?: string } }) => (
    <div style={{ display: style?.display }}>{children}</div>
  ),
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  ActivityIndicator: () => <span>loading</span>,
  Linking: { openURL: h.open },
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText(value: string): void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
      readOnly={!editable}
    />
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = "00000000-0000-4000-8000-000000000007";
const recipient = {
  fullName: "Creator",
  accountNumber: "12345678",
  address: "Singapore",
  swift: "DBSSSGSG",
  branchAddress: "Branch",
};
const balance = {
  currency: "USD",
  confirmedAmountMinor: "10000",
  availableAmountMinor: "10000",
  reservedAmountMinor: "0",
  paidAmountMinor: "0",
};
let root: Root, host: HTMLDivElement;
const mount = (userId = "alice", generation = 1) =>
  act(async () => root.render(<CreatorWithdrawals userId={userId} generation={generation} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const input = (label: string, value: string) =>
  act(async () => {
    const element = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
const response = (data: {
  currency: string;
  percentageBps: number;
  expectedAvailableAmountMinor: string;
}) => ({
  id,
  currency: data.currency,
  percentageBps: data.percentageBps,
  amountMinor: String(
    (BigInt(data.expectedAvailableAmountMinor) * BigInt(data.percentageBps)) / 10000n
  ),
  status: "pending",
  createdAt: "2026-10-06T00:00:00Z",
});
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.sequence = 0;
  h.records.clear();
  h.get.mockImplementation(async (path) =>
    path.endsWith("/balances")
      ? [balance]
      : path.endsWith("/recipient")
        ? { recipient }
        : { items: [], nextCursor: null }
  );
  h.post.mockImplementation(async (_path, { data }) => response(data));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads saved details, previews exact amounts, and submits only once for rapid taps", async () => {
  await mount();
  await click("creatorWithdrawals.withdraw");
  await input("creatorWithdrawals.percentage", "33.33");
  expect(host.textContent).toContain("USD 3333");
  await act(async () => {
    button("creatorWithdrawals.submit").click();
    button("creatorWithdrawals.submit").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    percentageBps: 3333,
    expectedAvailableAmountMinor: "10000",
    recipient,
  });
  expect(host.textContent).toContain("creatorWithdrawals.submitted");
  expect(h.records.get("alice")).toBe("");
});
it("restores frozen terms after an ambiguous response and route reopen even when balance is now zero", async () => {
  h.post.mockRejectedValueOnce(Error("Response lost"));
  await mount();
  await click("creatorWithdrawals.withdraw");
  await click("creatorWithdrawals.submit");
  const request = h.post.mock.calls[0][1].data;
  expect(host.textContent).toContain("Response lost");
  expect(host.querySelector("input")!.readOnly).toBe(true);
  await act(async () => root.render(null));
  h.get.mockImplementation(async (path) =>
    path.endsWith("/balances")
      ? [{ ...balance, availableAmountMinor: "0" }]
      : { items: [], nextCursor: null }
  );
  await mount();
  expect(
    host.querySelector<HTMLInputElement>(
      'input[aria-label="creatorWithdrawals.bank.accountNumber"]'
    )!.value
  ).toBe(recipient.accountNumber);
  await click("creatorWithdrawals.retry");
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.post.mock.calls[1][1].data).toEqual(request);
  expect(host.textContent).toContain("creatorWithdrawals.submitted");
});
it("requires reviewing a changed balance after a definitive conflict", async () => {
  h.post.mockRejectedValueOnce(new ApiRequestError(409, "Your available earnings changed.", 409));
  await mount();
  await click("creatorWithdrawals.withdraw");
  await click("creatorWithdrawals.submit");
  expect(host.textContent).toContain("Your available earnings changed.");
  expect(h.records.get("alice")).toBe("");
  expect(button("creatorWithdrawals.submit")).toBeUndefined();
  await click("creatorWithdrawals.reviewBalance");
  expect(host.querySelector("input")).toBeNull();
});
it("retains an unsent bank draft across background and refreshes private balances on return", async () => {
  await mount();
  await click("creatorWithdrawals.withdraw");
  await input("creatorWithdrawals.bank.fullName", "Draft creator");
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="creatorWithdrawals.bank.fullName"]')!
      .value
  ).toBe("Draft creator");
  expect(h.post).not.toHaveBeenCalled();
});
it("retains a request interrupted by account change without exposing it to another account", async () => {
  let finish!: (v: unknown) => void;
  h.post.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await mount();
  await click("creatorWithdrawals.withdraw");
  await click("creatorWithdrawals.submit");
  const request = h.post.mock.calls[0][1].data;
  h.generation = 2;
  await mount("bob", 2);
  await act(async () => finish(response(request)));
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).not.toContain("creatorWithdrawals.submitted");
  expect(h.records.get("alice")).toBeTruthy();
  expect(h.records.get("bob")).toBeUndefined();
});
it("shows saved-recipient failures and allows retry without enabling a premature request", async () => {
  const implementation = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path) => {
    if (path.endsWith("/recipient")) throw Error("Bank detail lookup failed");
    return implementation(path);
  });
  await mount();
  await click("creatorWithdrawals.withdraw");
  expect(host.textContent).toContain("Bank detail lookup failed");
  expect(button("creatorWithdrawals.submit")).toBeUndefined();
  h.get.mockImplementation(implementation);
  await click("creatorWithdrawals.retry");
  expect(host.querySelector("input")).not.toBeNull();
});
it("obtains fresh proof links on every tap and surfaces denied access", async () => {
  const paid = {
    ...response({ currency: "USD", percentageBps: 10000, expectedAvailableAmountMinor: "10000" }),
    status: "paid",
    paidAt: "2026-10-06T01:00:00Z",
    hasPaymentProof: true,
    resolutionReason: null,
  };
  h.get.mockImplementation(async (path) =>
    path.endsWith("/balances") ? [balance] : { items: [paid], nextCursor: null }
  );
  h.post
    .mockRejectedValueOnce(Error("Proof access denied"))
    .mockResolvedValue({ url: "https://files.test/proof.pdf", expiresAt: "2099-01-01T00:00:00Z" });
  await mount();
  await click("creatorWithdrawals.viewPaymentProof");
  expect(host.textContent).toContain("Proof access denied");
  expect(h.open).not.toHaveBeenCalled();
  await click("creatorWithdrawals.viewPaymentProof");
  expect(h.open).toHaveBeenCalledWith("https://files.test/proof.pdf");
  expect(h.post).toHaveBeenCalledTimes(2);
});

it("lets the creator retry unavailable pending storage without discarding the request", async () => {
  h.records.set("alice", "incomplete record");
  await mount();
  expect(button("creatorWithdrawals.withdraw").disabled).toBe(true);
  expect(h.post).not.toHaveBeenCalled();
  h.records.set(
    "alice",
    JSON.stringify({
      requestId: id,
      currency: "USD",
      percentageBps: 5000,
      expectedAvailableAmountMinor: "10000",
      recipient,
    })
  );
  await click("creatorWithdrawals.retry");
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="creatorWithdrawals.percentage"]')!.value
  ).toBe("50");
  await click("creatorWithdrawals.retry");
  expect(h.post.mock.calls[0][1].data.requestId).toBe(id);
  expect(host.textContent).toContain("creatorWithdrawals.submitted");
});
it("explains invalid bank details without blaming valid fields for a percentage error", async () => {
  await mount();
  await click("creatorWithdrawals.withdraw");
  await input("creatorWithdrawals.percentage", "0");
  expect(host.textContent).toContain("creatorWithdrawals.invalidPercentage");
  expect(host.textContent).not.toContain("creatorWithdrawals.invalidBankDetails");
  await input("creatorWithdrawals.percentage", "100");
  await input("creatorWithdrawals.bank.swift", "BAD");
  expect(host.textContent).toContain("creatorWithdrawals.invalidBankDetails");
  expect(button("creatorWithdrawals.submit").disabled).toBe(true);
});
