// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi, afterEach } from "vitest";
import UsagePage from "./page";
const state = vi.hoisted(() => ({ role: "owner", error: null as Error | null, refetch: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "fixture" } }),
}));
vi.mock("@/app/_components/workspace-context", () => ({
  useActiveWorkspace: () => ({ id: "fixture", role: state.role }),
  useWorkspace: () => ({ activeWorkspace: { id: "fixture", role: state.role }, loading: false }),
}));
vi.mock("@/app/_components/entitlement-context", () => ({
  useMyEntitlement: () => ({ data: undefined }),
}));
vi.mock("@/app/_components/credits-badge", () => ({
  useComputeWalletBalance: () => ({
    error: state.error,
    refetch: state.refetch,
    data: { available: BigInt(10), total: BigInt(20) },
  }),
}));
vi.mock("@/app/_components/subscription-dialog", () => ({
  SubscriptionDialog: ({ open }: { open: boolean }) =>
    open
      ? createElement("div", { "data-testid": "membership-dialog" }, "Membership checkout")
      : null,
}));
vi.mock("../_components/settings-ui", () => ({
  PageHeader: () => null,
  Panel: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../_components/current-plan-panel", () => ({
  CurrentPlanPanel: ({ onManagePlan }: { onManagePlan: () => void }) =>
    createElement("button", { onClick: onManagePlan }, "Manage plan"),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  state.role = "owner";
  state.error = null;
  state.refetch.mockClear();
  window.location.hash = "";
});
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(UsagePage)));
  return {
    host,
    close: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
it("opens billing settings for Recharge without opening membership checkout", async () => {
  const s = await mount();
  try {
    const button = Array.from(s.host.querySelectorAll("button")).find(
      (b) => b.textContent === "rechargeCredits"
    )!;
    await act(async () => button.click());
    expect(window.location.hash).toBe("#settings/billing");
    expect(s.host.querySelector('[data-testid="membership-dialog"]')).toBeNull();
  } finally {
    s.close();
  }
});
it("keeps Recharge hidden for a viewer", async () => {
  state.role = "viewer";
  const s = await mount();
  try {
    expect(
      Array.from(s.host.querySelectorAll("button")).some((b) => b.textContent === "rechargeCredits")
    ).toBe(false);
  } finally {
    s.close();
  }
});

it("keeps Manage Plan opening membership checkout", async () => {
  const s = await mount();
  try {
    const button = Array.from(s.host.querySelectorAll("button")).find(
      (b) => b.textContent === "Manage plan"
    )!;
    await act(async () => button.click());
    expect(s.host.querySelector('[data-testid="membership-dialog"]')).not.toBeNull();
    expect(window.location.hash).toBe("");
  } finally {
    s.close();
  }
});

it("shows the balance failure and lets the user retry", async () => {
  state.error = new Error("Balance service unavailable");
  const s = await mount();
  try {
    expect(s.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Balance service unavailable"
    );
    act(() =>
      [...s.host.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
    );
    expect(state.refetch).toHaveBeenCalledOnce();
  } finally {
    s.close();
  }
});
