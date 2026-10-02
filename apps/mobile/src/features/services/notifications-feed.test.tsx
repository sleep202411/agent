import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificationItem } from "./notification-api";
import { NotificationsFeed } from "./notifications-feed";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  push: vi.fn(),
  read: vi.fn(),
  readAll: vi.fn(),
  refresh: vi.fn(),
  items: [] as NotificationItem[],
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/config", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/navigation", () => ({ toHref: (s: string) => s }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("./notification-api", () => ({
  readNotification: h.read,
  readAllNotifications: h.readAll,
}));
vi.mock("./use-inbox-realtime", () => ({ useInboxRealtime: () => false }));
vi.mock("./user-displays", () => ({ useUserDisplays: () => undefined }));
vi.mock("./use-notifications", () => ({
  useNotifications: () => ({ items: h.items, refresh: h.refresh, loading: false }),
}));
vi.mock("@/components/authed-web-view", () => ({ AuthedWebView: () => <div>Web</div> }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Linking: { openURL: vi.fn() },
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
  FlatList: ({
    data,
    renderItem,
  }: {
    data: NotificationItem[];
    renderItem: (p: { item: NotificationItem }) => ReactNode;
  }) => (
    <div>
      {data.map((item) => (
        <div key={item.id}>{renderItem({ item })}</div>
      ))}
    </div>
  ),
}));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = () =>
  act(async () => root.render(<NotificationsFeed generation={1} userId="user" />));
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.generation = 1;
  h.read.mockResolvedValue({});
  h.items = [
    {
      id: "notice",
      type: "crew.task.assigned",
      title: "Task assigned",
      body: "Please review",
      meta: { deeplink: "/crews" },
      createdAt: "2026-10-02T00:00:00Z",
      readAt: null,
    },
  ];
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("opens immediately and lets the read intent complete after navigation unmounts the feed", async () => {
  let finish!: () => void;
  h.read.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await click("notifications.view");
  expect(h.push).toHaveBeenCalledWith("/crews");
  expect(h.read).toHaveBeenCalledWith("notice", 1, expect.any(AbortSignal));
  const signal = h.read.mock.calls[0][2] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(false);
  await act(async () => finish());
  expect(h.push).toHaveBeenCalledTimes(1);
  expect(h.refresh).not.toHaveBeenCalled();
});
it("does not mark already-read notifications again", async () => {
  h.items[0].readAt = "2026-10-02T01:00:00Z";
  await render();
  await click("notifications.view");
  expect(h.read).not.toHaveBeenCalled();
  expect(h.push).toHaveBeenCalledWith("/crews");
});
it("a failed read receipt does not block the target", async () => {
  h.read.mockRejectedValue(Error("Offline"));
  await render();
  await click("notifications.view");
  expect(h.push).toHaveBeenCalledWith("/crews");
  expect(host.textContent).toContain("Offline");
});
it("explicit mark-read remains cancellable when leaving the feed", async () => {
  let finish!: () => void;
  h.read.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await click("notifications.markRead");
  const signal = h.read.mock.calls[0][2] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
  expect(h.push).not.toHaveBeenCalled();
});

it("does not open or write from an obsolete account", async () => {
  await render();
  h.generation = 2;
  await click("notifications.view");
  expect(h.read).not.toHaveBeenCalled();
  expect(h.push).not.toHaveBeenCalled();
});
