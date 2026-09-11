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

vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map([["actor-1", { nickname: "Isaac" }]]),
}));

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const i18n = vi.hoisted(() => ({ locale: "en-US" }));
const dataHooks = vi.hoisted(() => ({
  feed: vi.fn(),
  read: vi.fn(),
  next: vi.fn(),
  nextError: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
}));

vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => i18n.locale,
  useTranslations: () => (key: string, vars?: Record<string, string | number>) =>
    Object.entries(vars ?? {}).reduce(
      (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
      key.endsWith("bodyWithActor")
        ? "Changed by {actor}"
        : key === "performedBy"
          ? "By {name}"
          : key
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
    useNotificationFeed: (size: number, filter: string) => {
      dataHooks.feed(size, filter);
      return {
        data: { pages: [{ items: [ITEM] }] },
        isLoading: false,
        isError: dataHooks.nextError,
        isFetchNextPageError: dataHooks.nextError,
        error: dataHooks.nextError ? new Error("Page unavailable") : null,
        hasNextPage: dataHooks.nextError,
        isFetchingNextPage: false,
        fetchNextPage: dataHooks.next,
      };
    },
    useUnreadCount: () => ({ data: 1 }),
    useMarkRead: () => ({ mutate: dataHooks.read }),
    useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

const { NotificationsFeed } = await import("./notifications-feed");

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
  dataHooks.nextError = false;
  dataHooks.next.mockClear();
  nav.push.mockClear();
  dataHooks.read.mockClear();
  dataHooks.feed.mockClear();
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

    act(() => root.render(<NotificationsFeed />));
    act(() => {
      rowButton().click();
    });

    expect(nav.push).toHaveBeenCalledTimes(1);
    const pushed = nav.push.mock.calls[0]![0] as string;
    expect(pushed.split("/")[1]).toBe(locale);
    expect(pushed).toBe(`/${locale}${DEEPLINK}`);
  });
});

it("selecting a filter requests that category from the server", () => {
  act(() => root.render(<NotificationsFeed />));
  const filter = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "filters.sharing"
  )!;
  act(() => filter.click());
  expect(dataHooks.feed).toHaveBeenLastCalledWith(30, "sharing");
  expect(filter.getAttribute("aria-pressed")).toBe("true");
});

it("opening an unread notification marks its own id as read", () => {
  act(() => root.render(<NotificationsFeed />));
  act(() => rowButton().click());
  expect(dataHooks.read).toHaveBeenCalledWith(ITEM.id);
});

it("shows the resolved actor name for a task notification", () => {
  const original = ITEM.meta;
  ITEM.meta = { ...original, actorUserId: "actor-1", taskTitle: "Storyboard" };
  try {
    act(() => root.render(<NotificationsFeed />));
    expect(container.textContent).toContain("Changed by Isaac");
  } finally {
    ITEM.meta = original;
  }
});

it("identifies a comment author while preserving the comment text", () => {
  const original = { ...ITEM };
  ITEM.type = "crew.task.commented";
  ITEM.meta = {
    actorUserId: "actor-1",
    taskTitle: "Storyboard",
    commentBody: "Please revise the final frame",
  };
  try {
    act(() => root.render(<NotificationsFeed />));
    expect(container.textContent).toContain("By Isaac");
    expect(container.textContent).toContain("Please revise the final frame");
  } finally {
    Object.assign(ITEM, original);
  }
});

it("keeps loaded notifications visible when pagination fails and retries that page", () => {
  dataHooks.nextError = true;
  act(() => root.render(<NotificationsFeed />));
  expect(rowButton()).toBeDefined();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Page unavailable");
  const retry = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "retry"
  );
  expect(retry).toBeDefined();
  act(() => retry!.click());
  expect(dataHooks.next).toHaveBeenCalledOnce();
});
