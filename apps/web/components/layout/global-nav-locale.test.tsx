import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/en-US/crews",
  locale: "en-US",
  replace: vi.fn(),
  language: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace, push: vi.fn() }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@gsap/react", () => ({ useGSAP: () => {} }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: "123", nickname: "Creator" } }),
}));
vi.mock("@/src/hooks/use-logout", () => ({ useLogout: () => vi.fn() }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => state.locale,
  useTranslations: () => (key: string) => key,
  setLanguage: state.language,
}));
vi.mock("@/components/layout/community-credits-chip", () => ({ CommunityCreditsChip: () => null }));
vi.mock("@/components/notifications/bell-button", () => ({ BellButton: () => null }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("@/components/ui/shiny-text", () => ({ ShinyText: () => null }));
vi.mock("./app-download-menu", () => ({ AppDownloadMenu: () => null, APP_DOWNLOADS: [] }));
vi.mock("@/app/(site)/creators/_hooks/use-conversations", () => ({
  useInbox: () => ({ data: [] }),
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { DropdownMenu: Wrapper, DropdownMenuTrigger: Wrapper, DropdownMenuContent: Wrapper };
});

import { GlobalNav } from "./global-nav";
import { getCurrentLocale } from "@/src/i18n/locale-url";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.locale = "en-US";
  state.pathname = "/en-US/crews";
  window.history.replaceState(null, "", state.pathname);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function click(text: string, last = false) {
  const buttons = Array.from(container.querySelectorAll("button"));
  const matches = buttons.filter(
    (button) => button.textContent?.trim() === text || button.getAttribute("aria-label") === text
  );
  const button = last ? matches.at(-1) : matches[0];
  expect(button).toBeDefined();
  act(() => button!.click());
}

it.each([
  ["en-US", "简体中文", "zh-CN"],
  ["zh-CN", "繁體中文", "zh-HK"],
  ["zh-HK", "English", "en-US"],
])("preserves the selected Crew and fan channel when switching from %s", (from, label, to) => {
  state.locale = from;
  state.pathname = `/${from}/crews`;
  const suffix = "?crew=crew-123&channel=community&tab=chat#latest";
  window.history.replaceState(null, "", state.pathname + suffix);
  act(() => root.render(<GlobalNav />));
  click(label);
  expect(state.replace).toHaveBeenCalledWith(`/${to}/crews${suffix}`);
  expect(state.language).toHaveBeenCalledWith(to);
  expect(getCurrentLocale()).toBe(to);
});

it("uses the current URL suffix when the mobile menu switches language", () => {
  act(() => root.render(<GlobalNav />));
  click("menu");
  window.history.replaceState(null, "", "/en-US/crews?crew=new&task=task-2#details");
  click("简体中文", true);
  expect(state.replace).toHaveBeenCalledWith("/zh-CN/crews?crew=new&task=task-2#details");
});

it("keeps a locale-only home URL free of an extra slash", () => {
  state.pathname = "/en-US";
  window.history.replaceState(null, "", "/en-US?ref=a%2Fb&ref=c#intro");
  act(() => root.render(<GlobalNav />));
  click("简体中文");
  expect(state.replace).toHaveBeenCalledWith("/zh-CN?ref=a%2Fb&ref=c#intro");
});

it("does not navigate when choosing the current language", () => {
  act(() => root.render(<GlobalNav />));
  click("English");
  expect(state.replace).not.toHaveBeenCalled();
  expect(state.language).not.toHaveBeenCalled();
});

it("links the message and saved-job shortcuts to localized destinations", () => {
  state.locale = "zh-HK";
  state.pathname = "/zh-HK/crews";
  window.history.replaceState(null, "", state.pathname);
  act(() => root.render(<GlobalNav />));
  expect(container.querySelector('a[aria-label="messagesShortcut"]')?.getAttribute("href")).toBe(
    "/zh-HK/messages"
  );
  expect(container.querySelector('a[aria-label="savedJobsShortcut"]')?.getAttribute("href")).toBe(
    "/zh-HK/crews?view=positions&saved=true"
  );
  click("menu");
  expect(
    Array.from(container.querySelectorAll("a")).filter(
      (link) => link.getAttribute("href") === "/zh-HK/crews?view=positions&saved=true"
    ).length
  ).toBeGreaterThan(1);
});
