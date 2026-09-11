import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ConversationsProvider } from "./provider";
import { openConversationRealtime } from "./ably-client";
import { markNotificationRead } from "@/src/lib/notifications/api";
import { toast } from "sonner";

const mocks = vi.hoisted(() => ({
  userId: "alice" as string | null,
  router: { push: vi.fn() },
  t: (key: string) => key,
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => mocks.t }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("./ably-client", () => ({
  openConversationRealtime: vi.fn(() => ({ close: vi.fn(), isOpen: true })),
}));
vi.mock("@/src/lib/notifications/api", () => ({ markNotificationRead: vi.fn() }));
vi.mock("@/src/lib/notifications", () => ({
  notificationKeys: { all: ["notifications"] },
  notificationHref: () => "/en-US/messages/chat",
  notificationContent: () => ({ title: "Notice", body: "Body" }),
}));
vi.mock("@/app/(site)/creators/_hooks/use-conversations", () => ({
  createConversationRecoveryCoordinator: () => ({
    receiveMessage: vi.fn(),
    recoverAll: vi.fn(),
    dispose: vi.fn(),
  }),
  conversationKeys: {
    messages: (id: string, uid: string) => ["conversation", "messages", id, uid],
    detail: (id: string, uid: string) => ["conversation", "detail", id, uid],
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  ["message", "alice"],
  ["message", "bob"],
  ["message", null],
  ["notification", "alice"],
  ["notification", "bob"],
  ["notification", null],
] as const)("scopes %s toast actions when the current account is %s", async (kind, nextUser) => {
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  const render = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ConversationsProvider>content</ConversationsProvider>
        </QueryClientProvider>
      )
    );
  };
  try {
    mocks.userId = "alice";
    vi.mocked(markNotificationRead).mockResolvedValue(
      {} as Awaited<ReturnType<typeof markNotificationRead>>
    );
    await render();
    const handlers = vi.mocked(openConversationRealtime).mock.calls.at(-1)![1];
    if (kind === "notification") {
      handlers.onNotification?.({
        id: "notice",
        type: "crew.task.assigned",
        readAt: null,
      } as Parameters<NonNullable<typeof handlers.onNotification>>[0]);
    } else {
      handlers.onMessage?.({
        conversationId: "chat",
        message: { authorId: "other", type: "text", body: "hello" },
      } as Parameters<NonNullable<typeof handlers.onMessage>>[0]);
    }
    const action = vi.mocked(toast).mock.calls.at(-1)![1]!.action as unknown as {
      onClick: () => void;
    };
    expect(action).toBeDefined();
    mocks.userId = nextUser;
    await render();
    await act(async () => action.onClick());
    expect(markNotificationRead).toHaveBeenCalledTimes(
      nextUser === "alice" && kind === "notification" ? 1 : 0
    );
    expect(mocks.router.push).toHaveBeenCalledTimes(nextUser === "alice" ? 1 : 0);
  } finally {
    act(() => root.unmount());
    client.clear();
    mocks.userId = "alice";
    vi.clearAllMocks();
  }
});

it("refreshes owner pending counts when another user submits an application", async () => {
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  const affected = [
    ["crew", "detail", "crew-a", "alice"],
    ["crew", "mine", "alice"],
  ];
  const unaffected = [
    ["crew", "detail", "crew-b", "alice"],
    ["crew", "detail", "crew-a", "bob"],
    ["crew", "mine", "bob"],
  ];
  for (const key of [...affected, ...unaffected])
    client.setQueryData(key, { pendingApplicationCount: 0 });
  try {
    mocks.userId = "alice";
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ConversationsProvider>content</ConversationsProvider>
        </QueryClientProvider>
      )
    );
    const handlers = vi.mocked(openConversationRealtime).mock.calls.at(-1)![1];
    handlers.onNotification?.({
      id: "new-application",
      title: "New application",
      body: "An applicant applied",
      readAt: null,
      createdAt: "2026-09-11T00:00:00Z",
      type: "crew.application.submitted",
      meta: { crewId: "crew-a" },
    } as Parameters<NonNullable<typeof handlers.onNotification>>[0]);
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of unaffected) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  } finally {
    act(() => root.unmount());
    client.clear();
    vi.clearAllMocks();
  }
});
