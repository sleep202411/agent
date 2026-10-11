import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SubscriptionPanel } from "./subscription-panel";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  authenticated: true,
  get: vi.fn(),
  post: vi.fn(),
  login: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: String(h.generation) },
  }),
  useAuthGate: () => ({ openLogin: h.login }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (_: string, user: string) => ({
    read: () => h.records.get(user) ?? null,
    write: (v: string) => h.records.set(user, v),
  }),
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => (k: string) => k }));
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
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: () => null,
}));
const id = "00000000-0000-4000-8000-000000000001";
const subscription = {
  id,
  status: "active",
  planKey: "pro",
  productType: "membership_plan",
  subjectType: "user",
  currency: "USD",
  amountMinor: "2999",
  interval: "month",
  currentPeriodEnd: "2026-11-04T00:00:00Z",
  cancelAtPeriodEnd: false,
  canceledAt: null,
  endedAt: null,
};
const plan = { entitlement: { planKey: "pro", status: "active", expiresAt: null }, subscription };
let host: HTMLDivElement,
  root: Root,
  canManage = true,
  workspaceId: string | undefined;
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <SubscriptionPanel
          generation={h.generation}
          workspaceId={workspaceId}
          canManage={canManage}
        />
      </StrictMode>
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  canManage = true;
  workspaceId = undefined;
  h.get.mockResolvedValue(plan);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("recovers a failed plan read without presenting a fake free plan", async () => {
  h.get.mockRejectedValueOnce(Error("Plan unavailable"));
  await act(async () => root.render(<SubscriptionPanel generation={1} canManage />));
  expect(host.textContent).toContain("Plan unavailable");
  expect(host.textContent).not.toContain("subscription.free");
  await act(async () => button("common.retry").click());
  expect(host.textContent).toContain("Pro");
});
it("requires confirmation, serializes cancellation and displays access through period end", async () => {
  let finish!: (v: unknown) => void;
  h.post.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await render();
  await act(async () => button("subscription.cancel").click());
  expect(h.post).not.toHaveBeenCalled();
  await act(async () => {
    button("subscription.confirmCancel").click();
    button("subscription.confirmCancel").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...subscription, status: "canceled", cancelAtPeriodEnd: true }));
  expect(host.textContent).toContain("subscription.cancelled");
  expect(host.textContent).toContain("subscription.accessUntil");
  expect(button("subscription.cancel")).toBeUndefined();
});
it("retires confirmations when workspace or billing permission changes", async () => {
  await render();
  await act(async () => button("subscription.cancel").click());
  workspaceId = id;
  await render();
  expect(button("subscription.confirmCancel")).toBeUndefined();
  await act(async () => button("subscription.cancel").click());
  canManage = false;
  await render();
  expect(button("subscription.confirmCancel")).toBeUndefined();
  expect(button("subscription.cancel")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
});
it("ignores late cancellation from a previous account", async () => {
  let finish!: (v: unknown) => void;
  h.post.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await render();
  await act(async () => button("subscription.cancel").click());
  await act(async () => button("subscription.confirmCancel").click());
  const signal = h.post.mock.calls[0][1].signal as AbortSignal;
  h.generation++;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ ...subscription, status: "canceled", cancelAtPeriodEnd: true }));
  expect(host.textContent).not.toContain("subscription.cancelled");
  expect(button("subscription.cancel")).toBeDefined();
});
it("shows provider failures and permits a fresh cancellation attempt", async () => {
  h.post
    .mockRejectedValueOnce(Error("Provider cannot cancel here"))
    .mockResolvedValueOnce({ ...subscription, status: "canceled", cancelAtPeriodEnd: true });
  await render();
  await act(async () => button("subscription.cancel").click());
  await act(async () => button("subscription.confirmCancel").click());
  expect(host.textContent).toContain("Provider cannot cancel here");
  await act(async () => button("subscription.confirmCancel").click());
  expect(host.textContent).toContain("subscription.cancelled");
  expect(host.textContent).not.toContain("Provider cannot cancel here");
});
