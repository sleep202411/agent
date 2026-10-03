// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckInCard } from "./check-in-card";
const h = vi.hoisted(() => ({
  user: { id: "A" } as { id: string } | null,
  status: vi.fn(),
  claim: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: h.user, isCurrentAccount: (id: string) => h.user?.id === id }),
}));
vi.mock("@/lib/billing", () => ({
  getCheckInStatus: (...args: unknown[]) => h.status(...args),
  dailyCheckIn: () => h.claim(),
}));
vi.mock("@/app/_components/credits-badge", () => ({ computeWalletBalanceQueryKey: ["balance"] }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
let root: Root, host: HTMLDivElement, client: QueryClient;
const status = {
  enabled: true,
  rewards: [10],
  checkedInToday: false,
  streak: 0,
  nextStreakDay: 1,
  nextReward: 10,
  todayReward: 10,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CheckInCard compact />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}
function click() {
  (host.querySelector("button") as HTMLButtonElement).click();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  h.user = { id: "A" };
  h.status.mockResolvedValue(status);
  h.claim.mockResolvedValue({ granted: { amount: "10" }, alreadyCheckedIn: false });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
it("hides cached check-in controls on sign-out", async () => {
  await render();
  expect(host.querySelector("button")).not.toBeNull();
  h.user = null;
  await render();
  expect(host.querySelector("button")).toBeNull();
});
it("loads account B independently of A's fresh checked-in cache", async () => {
  h.status.mockResolvedValueOnce({ ...status, checkedInToday: true });
  await render();
  expect(host.querySelector("button")?.disabled).toBe(true);
  h.user = { id: "B" };
  await render();
  expect(h.status).toHaveBeenCalledTimes(2);
  expect(host.querySelector("button")?.disabled).toBe(false);
});
it.each([false, true])("suppresses abandoned claim feedback (failure=%s)", async (failure) => {
  const pending = deferred<unknown>();
  h.claim.mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => click());
  h.user = { id: "B" };
  await render();
  await act(async () => {
    if (failure) pending.reject(new Error("old failure"));
    else pending.resolve({ granted: { amount: "10" }, alreadyCheckedIn: false });
  });
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  expect(host.querySelector("button")?.disabled).toBe(false);
});
it("reports active failure and permits retry and successful claim", async () => {
  h.claim.mockRejectedValueOnce(new Error("retry me"));
  await render();
  await act(async () => click());
  expect(h.error).toHaveBeenCalledWith("retry me");
  await act(async () => click());
  expect(h.claim).toHaveBeenCalledTimes(2);
  expect(h.success).toHaveBeenCalledWith("checkIn.success");
});

it("admits only one claim before the pending render", async () => {
  const pending = deferred<unknown>();
  h.claim.mockReturnValue(pending.promise);
  await render();
  act(() => {
    click();
    click();
  });
  expect(h.claim).toHaveBeenCalledTimes(1);
});

it("aborts an abandoned status read on sign-out", async () => {
  h.status.mockReturnValue(new Promise(() => {}));
  await render();
  const signal = h.status.mock.calls[0][0] as AbortSignal;
  expect(signal.aborted).toBe(false);
  h.user = null;
  await render();
  expect(signal.aborted).toBe(true);
});

it("keeps a failed status read visible and recovers to the claim flow", async () => {
  h.status.mockRejectedValueOnce(new Error("Check-in unavailable"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Check-in unavailable");
  expect(host.textContent).not.toContain("checkIn.claim");
  await act(async () => click());
  await render();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("checkIn.claim");
  await act(async () => click());
  expect(h.claim).toHaveBeenCalledOnce();
});
