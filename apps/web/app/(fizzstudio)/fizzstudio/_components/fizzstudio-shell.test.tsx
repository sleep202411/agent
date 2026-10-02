// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FizzStudioShell } from "./fizzstudio-shell";
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/image", () => ({ default: "img" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/src/lib/api", () => ({ setApiWorkspaceId: vi.fn() }));
vi.mock("../../_hooks/use-workspace", () => ({}));
vi.mock("@/components/studio-account-menu", () => ({ StudioAccountMenu: () => null }));
vi.mock("@/components/payment/upgrade-dialog", () => ({ UpgradeDialog: () => null }));
vi.mock("./compute-topup-dialog", () => ({ ComputeTopupButton: () => null }));
vi.mock("./fizzstudio-sidebar", () => ({ FizzStudioSidebar: () => null }));
vi.mock("./workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
it.each(["studio", "enterprise"] as const)(
  "%s header links to the localized platform inbox",
  (variant) => {
    for (const locale of ["en-US", "zh-CN", "zh-HK"] as const) {
      const html = renderToStaticMarkup(
        <FizzStudioShell
          headerVariant={variant}
          workspaceState={{
            activeWorkspaceId: "one",
            workspaceId: "one",
            currentLocale: locale,
            isWorkspaceLoading: false,
            setActiveWorkspaceId: vi.fn(),
            workspaces: [],
          }}
        >
          {null}
        </FizzStudioShell>
      );
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(host.querySelector('a[aria-label="shell.chat"]')?.getAttribute("href")).toBe(
        `/${locale}/messages`
      );
      expect(host.querySelector('a[aria-label="shell.notifications"]')?.getAttribute("href")).toBe(
        `/${locale}/messages?tab=notifications`
      );
    }
  }
);
