// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsOverlay } from "./settings-overlay";

const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  pending: null as null | (() => void),
  requireAuth: (callback: () => void) => {
    auth.pending = callback;
  },
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: auth.user, loading: false, requireAuth: auth.requireAuth }),
}));
vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ activeWorkspace: null }),
}));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/images" }));
vi.mock("../settings/_components/settings-ui", () => ({ LetterAvatar: () => null }));
vi.mock("../settings/account/page", () => ({ default: () => "Account" }));
vi.mock("../settings/overview/page", () => ({ default: () => "Overview" }));
vi.mock("../settings/members/page", () => ({ default: () => "Members" }));
vi.mock("../settings/usage/page", () => ({ default: () => "Usage" }));
vi.mock("../settings/analytics/page", () => ({ default: () => "Analytics" }));
vi.mock("../settings/billing/page", () => ({ default: () => "Billing" }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement("div", { role: "dialog" }, children) : null,
  DialogContent: ({ children }: { children: ReactNode }) => children,
  DialogTitle: ({ children }: { children: ReactNode }) => children,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each([false, true])(
  "resumes settings only if gated login succeeds (success=%s)",
  async (success) => {
    auth.user = null;
    auth.pending = null;
    history.replaceState(null, "", "/images?fixture=1#settings/billing");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(SettingsOverlay)));
      expect(auth.pending).not.toBeNull();
      expect(location.hash).toBe("");
      if (success) {
        await act(async () => {
          auth.pending!();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
      } else {
        // AuthProvider drops this action when login is cancelled.
        auth.pending = null;
      }
      auth.user = { id: "fixture" };
      await act(async () => root.render(createElement(SettingsOverlay)));
      expect(host.querySelector('[role="dialog"]') !== null).toBe(success);
      expect(location.search).toBe("?fixture=1");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      auth.user = null;
      auth.pending = null;
      history.replaceState(null, "", "/");
    }
  }
);
