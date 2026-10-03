// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RedeemVoucherPanel } from "./redeem-voucher-panel";
const mocks = vi.hoisted(() => ({
  userId: "a",
  redeem: vi.fn(),
  invalidate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: mocks.userId },
    isCurrentAccount: (id: string) => id === mocks.userId,
  }),
}));
vi.mock("@/lib/billing", () => ({ redeemVoucher: mocks.redeem }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/app/_components/credits-badge", () => ({ computeWalletBalanceQueryKey: ["balance"] }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("./settings-ui", () => ({ Panel: ({ children }: { children: ReactNode }) => children }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  mocks.userId = "a";
  vi.clearAllMocks();
});
async function setup() {
  let resolve!: (value: { granted: { amount: string }; alreadyRedeemed: boolean }) => void;
  let reject!: (reason: Error) => void;
  mocks.redeem.mockReturnValue(
    new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    })
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(async () => {
    root.render(createElement(RedeemVoucherPanel));
  });
  const input = host.querySelector("input")!;
  const change = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  change("FIRST");
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  return { input, change, resolve, reject, root, host };
}
it("preserves a new code entered while the previous code is redeeming", async () => {
  const s = await setup();
  s.change("SECOND");
  await act(async () => s.resolve({ granted: { amount: "10" }, alreadyRedeemed: false }));
  expect(s.input.value).toBe("SECOND");
  expect(mocks.redeem).toHaveBeenCalledWith("FIRST", expect.any(AbortSignal));
  expect(mocks.invalidate).toHaveBeenCalledOnce();
});
it("clears the unchanged code after success", async () => {
  const s = await setup();
  await act(async () => s.resolve({ granted: { amount: "10" }, alreadyRedeemed: false }));
  expect(s.input.value).toBe("");
});
it("preserves the draft after a failed redemption", async () => {
  const s = await setup();
  s.change("SECOND");
  await act(async () => s.reject(new Error("declined")));
  expect(s.input.value).toBe("SECOND");
  expect(mocks.error).toHaveBeenCalledWith("declined");
});

it("aborts abandoned redemption and does not clear a replacement account's form", async () => {
  const s = await setup();
  const signal = mocks.redeem.mock.calls[0]![1] as AbortSignal;
  mocks.userId = "b";
  await act(async () => s.root.render(createElement(RedeemVoucherPanel)));
  expect(signal.aborted).toBe(true);
  expect(s.host.querySelector("input")!.value).toBe("");
  await act(async () => s.resolve({ granted: { amount: "10" }, alreadyRedeemed: false }));
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
