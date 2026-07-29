// @vitest-environment jsdom

/**
 * The inbox is the surface where a wrong-locale push is most visible:
 * the reader is already deep in a localized session when they click.
 *
 * Only the data hooks and the router are mocked — `notificationHref` is
 * the real implementation, so this asserts the page actually routes
 * through it rather than pushing `meta.deeplink` raw.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationDTO } from "@repo/shared/notifications";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const i18n = vi.hoisted(() => ({ locale: "en-US" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
}));

vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => i18n.locale,
  useTranslations: () => (key: string, vars?: Record<string, string | number>) =>
    Object.entries(vars ?? {}).reduce(
      (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
      key
    ),
}));

const DEEPLINK = "/crews/c_1/workspace?tab=episodes&episode=ep_1";

const ITEM: NotificationDTO = {
  id: "n_1",
  type: "crew.task.assigned",
  title: "You were assigned EP01",
  body: "Storyboard — due Friday",
  meta: { deeplink: DEEPLINK },
  readAt: null,
  createdAt: new Date().toISOString(),
} as NotificationDTO;

vi.mock("@/src/lib/notifications", async () => {
  const { notificationHref } = await import("@/src/lib/notifications/deeplink");
  const { notificationContent } = await import("@/src/lib/notifications/content");
  return {
    notificationHref,
    notificationContent,
    useNotificationFeed: () => ({
      data: { pages: [{ items: [ITEM] }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    }),
    useUnreadCount: () => ({ data: 1 }),
    useMarkRead: () => ({ mutate: vi.fn() }),
    useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

const { default: NotificationsPage } = await import("./page");

let container: HTMLDivElement;
let root: Root;

/** The feed row rendered for ITEM — matched by its title text. */
function rowButton(): HTMLButtonElement {
  const buttons = [...container.querySelectorAll("button")];
  const row = buttons.find((b) => b.textContent?.includes(ITEM.title));
  if (!row) throw new Error("notification row not rendered");
  return row;
}

beforeEach(() => {
  nav.push.mockClear();
  i18n.locale = "en-US";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("notification inbox", () => {
  it.each(["en-US", "zh-CN", "zh-HK"])("pushes the deeplink under /%s", (locale) => {
    i18n.locale = locale;

    act(() => root.render(<NotificationsPage />));
    act(() => {
      rowButton().click();
    });

    expect(nav.push).toHaveBeenCalledTimes(1);
    const pushed = nav.push.mock.calls[0]![0] as string;
    expect(pushed.split("/")[1]).toBe(locale);
    expect(pushed).toBe(`/${locale}${DEEPLINK}`);
  });
});
