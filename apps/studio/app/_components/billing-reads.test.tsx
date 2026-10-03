// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { useComputeWalletBalance } from "./credits-badge";
import { EntitlementProvider, useMyEntitlement } from "./entitlement-context";
import { CurrentPlanPanel } from "@/app/[locale]/settings/_components/current-plan-panel";
const state = vi.hoisted(() => ({
  userId: "a" as string | null,
  workspaceId: "team-a",
  get: vi.fn(),
  entitlement: vi.fn(),
  cancel: vi.fn(),
  success: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    user: state.userId ? { id: state.userId } : null,
    isCurrentAccount: (id: string) => id === state.userId,
  }),
}));
vi.mock("./workspace-context", () => ({
  useWorkspace: () => ({}),
  useActiveWorkspaceId: () => state.workspaceId,
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectPayerWorkspace: () => ({ id: state.workspaceId }),
}));
vi.mock("@/lib/api", () => ({ api: { get: state.get } }));
vi.mock("@/lib/billing", () => ({
  getMyEntitlement: state.entitlement,
  cancelSubscription: state.cancel,
}));
vi.mock("@/lib/canvas-authoring/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: () => ({ subscribe: () => ({ close: vi.fn() }) }),
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: vi.fn() } }));
let root: Root, host: HTMLDivElement, client: QueryClient;
function Probe() {
  const balance = useComputeWalletBalance();
  const plan = useMyEntitlement();
  return (
    <>
      <output>{balance.data?.available.toString() ?? "unknown"}</output>
      <span>{plan.error?.message}</span>
      <button onClick={plan.retry}>Retry</button>
      <CurrentPlanPanel canManage onManagePlan={() => {}} />
    </>
  );
}
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};
const render = async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <EntitlementProvider>
          <Probe />
        </EntitlementProvider>
      </QueryClientProvider>
    )
  );
  await settle();
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.userId = "a";
  state.workspaceId = "team-a";
  state.get
    .mockReset()
    .mockResolvedValue({ available: "20", total: "20", held: "0", nextExpiry: null });
  state.cancel.mockReset();
  state.success.mockReset();
  state.entitlement
    .mockReset()
    .mockResolvedValue({ entitlement: { planKey: "free" }, subscription: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
it("does not show the previous account's fresh balance after account replacement or logout", async () => {
  await render();
  expect(host.querySelector("output")?.textContent).toBe("20");
  state.userId = "b";
  state.get.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(host.querySelector("output")?.textContent).toBe("unknown");
  expect(state.get).toHaveBeenCalledTimes(2);
  state.userId = null;
  await render();
  expect(host.querySelector("output")?.textContent).toBe("unknown");
  expect(state.get).toHaveBeenCalledTimes(2);
});
it("cancels balance and entitlement reads when their workspace is abandoned", async () => {
  state.get.mockImplementation(() => new Promise(() => {}));
  state.entitlement.mockImplementation(() => new Promise(() => {}));
  await render();
  const walletSignal = state.get.mock.calls[0]![1].signal as AbortSignal;
  const planSignal = state.entitlement.mock.calls[0]![1] as AbortSignal;
  state.workspaceId = "team-b";
  await render();
  expect(walletSignal.aborted).toBe(true);
  expect(planSignal.aborted).toBe(true);
  expect(state.get.mock.calls.at(-1)![1].headers["x-fizz-workspace-id"]).toBe("team-b");
});
it("exposes an entitlement retry that recovers the failed read", async () => {
  state.entitlement.mockRejectedValueOnce(new Error("Plan unavailable"));
  await render();
  expect(host.textContent).toContain("Plan unavailable");
  act(() => host.querySelector("button")!.click());
  await settle();
  expect(host.textContent).not.toContain("Plan unavailable");
  expect(state.entitlement).toHaveBeenCalledTimes(2);
});

it("clears subscription cancellation confirmation and ignores late completion after account replacement", async () => {
  const subscription = {
    id: "sub-a",
    status: "active",
    currentPeriodEnd: null,
    amountMinor: "1000",
    currency: "USD",
    interval: "month",
  };
  state.entitlement.mockResolvedValue({ entitlement: { planKey: "pro" }, subscription });
  let resolve!: (v: unknown) => void;
  state.cancel.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  const cancelButton = () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "cancelPlan")!;
  act(() => cancelButton().click());
  expect(host.textContent).toContain("cancelPlanConfirm");
  await act(async () => cancelButton().click());
  expect(state.cancel).toHaveBeenCalledWith("sub-a", "team-a", expect.any(AbortSignal));
  const signal = state.cancel.mock.calls[0]![2] as AbortSignal;
  state.userId = "b";
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("cancelPlanConfirm");
  await act(async () => resolve(subscription));
  expect(state.success).not.toHaveBeenCalled();
});
