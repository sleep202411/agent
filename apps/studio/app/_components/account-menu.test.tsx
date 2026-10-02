// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AccountMenu } from "./account-menu";
const s = vi.hoisted(() => ({ region: "global", locale: "en-US" }));
vi.mock("next-intl", () => ({
  useLocale: () => s.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("./auth-provider", () => ({
  useAuth: () => ({ user: { id: "123456789012345678", nickName: "Fixture" }, loading: false }),
}));
vi.mock("./entitlement-context", () => ({
  useMyEntitlement: () => ({}),
  formatEntitlementPlanName: () => "",
}));
vi.mock("./credits-badge", () => ({ useComputeWalletBalance: () => ({}) }));
vi.mock("./subscription-dialog", () => ({ SubscriptionDialog: () => null }));
vi.mock("@/app/_components/region-provider", () => ({ useSiteRegion: () => s.region }));
vi.mock("./locale-switcher", () => ({ LocaleMenuItems: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Slot = ({ children }: { children: ReactNode }) => children;
  return {
    DropdownMenu: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: ReactNode;
    }) =>
      createElement(
        "div",
        null,
        createElement("button", { onClick: () => onOpenChange(true) }, "Open menu"),
        open ? createElement("div", { role: "menu" }, children) : null
      ),
    DropdownMenuContent: Slot,
    DropdownMenuItem: Slot,
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: Slot,
    DropdownMenuSubContent: Slot,
    DropdownMenuSubTrigger: Slot,
    DropdownMenuTrigger: () => null,
  };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("dismisses the account menu when its Settings gear opens settings", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AccountMenu)));
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent === "Open menu")!
        .click()
    );
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="settings"]')!.click()
    );
    expect(location.hash).toBe("#settings/account");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent === "Open menu")!
        .click()
    );
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    history.replaceState(null, "", "/");
  }
});

it.each(["global", "cn"])(
  "offers the correct app downloads for %s regardless of locale",
  async (region) => {
    const { APP_DOWNLOADS_BY_SITE } = await import("@repo/shared");
    s.region = region;
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      for (const locale of ["en-US", "zh-CN", "zh-HK"]) {
        s.locale = locale;
        await act(async () => root.render(createElement(AccountMenu)));
        await act(async () =>
          Array.from(host.querySelectorAll("button"))
            .find((b) => b.textContent === "Open menu")!
            .click()
        );
        for (const item of APP_DOWNLOADS_BY_SITE[region as "global" | "cn"]) {
          const link = host.querySelector<HTMLAnchorElement>(`a[href="${item.href}"]`);
          expect(link).not.toBeNull();
          expect(link?.rel).toContain("noopener");
        }
      }
    } finally {
      await act(async () => root.unmount());
      s.region = "global";
      s.locale = "en-US";
    }
  }
);
