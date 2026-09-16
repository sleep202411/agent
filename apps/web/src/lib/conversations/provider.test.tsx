import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ConversationsProvider } from "./provider";
import { openConversationRealtime } from "./ably-client";
import { markNotificationRead } from "@/src/lib/notifications/api";
import { toast } from "sonner";
import { orderKeys } from "@/app/(site)/creators/_hooks/use-orders";

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
    inbox: () => ["conversation", "inbox"],
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

it.each(["read", "context", "notification", "ready"] as const)(
  "keeps %s realtime refreshes within the receiving account",
  async (event) => {
    const client = new QueryClient();
    const root = createRoot(document.createElement("div"));
    const family = event === "read" || event === "context" ? "conversation" : "notifications";
    const key = (account: string) =>
      family === "conversation" ? [family, "inbox", "all", account] : [family, "recent", account];
    for (const account of ["alice", "bob"]) client.setQueryData(key(account), []);
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
      await act(async () => {
        if (event === "read")
          handlers.onReadAdvanced?.(
            {} as Parameters<NonNullable<typeof handlers.onReadAdvanced>>[0]
          );
        if (event === "context")
          handlers.onContextChanged?.({ conversationId: "chat" } as Parameters<
            NonNullable<typeof handlers.onContextChanged>
          >[0]);
        if (event === "notification")
          handlers.onNotification?.({
            id: "notice",
            type: "crew.task.assigned",
            readAt: null,
          } as Parameters<NonNullable<typeof handlers.onNotification>>[0]);
        if (event === "ready") handlers.onReady?.();
      });
      expect(client.getQueryState(key("alice"))?.isInvalidated).toBe(true);
      expect(client.getQueryState(key("bob"))?.isInvalidated).toBe(false);
    } finally {
      act(() => root.unmount());
      client.clear();
      vi.clearAllMocks();
    }
  }
);

it.each(["task", "metadata"])(
  "scopes realtime %s refreshes to the receiving account",
  async (kind) => {
    const client = new QueryClient();
    const root = createRoot(document.createElement("div"));
    const keys = (account: string, crew = "crew-a") => [
      ["crew", "task-center", account, "all"],
      ["crew", "task-project", crew, account],
      ["crew", "task", `${crew}-parent`, account],
      ["crew", "task", `${crew}-task`, account],
      ["crew", "task", `${crew}-task`, "timeline", account],
      ["crew", "tasks", crew, "view", {}, account],
      ["crew", "production", crew, "overview", account],
      ["crew", "production", crew, "episodes", account],
      ["crew", "earnings", crew, "mine", "all", "USD", account],
    ];
    for (const account of ["alice", "bob"])
      for (const crew of ["crew-a", "crew-b"]) {
        for (const key of keys(account, crew)) client.setQueryData(key, { crewId: crew });
      }
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
      await act(async () => {
        if (kind === "task")
          handlers.onCrewTaskChanged?.({
            crewId: "crew-a",
            taskId: "crew-a-task",
            action: "reviewed",
          } as Parameters<NonNullable<typeof handlers.onCrewTaskChanged>>[0]);
        else
          handlers.onCrewTaskProjectChanged?.({
            crewId: "crew-a",
            resource: "workflow",
            resourceId: "state",
            action: "updated",
            actorUserId: "collaborator",
          } as Parameters<NonNullable<typeof handlers.onCrewTaskProjectChanged>>[0]);
      });
      expect(client.getQueryState(["crew", "task", "crew-a-parent", "alice"])?.isInvalidated).toBe(
        true
      );
      expect(
        client.getQueryState(["crew", "tasks", "crew-a", "view", {}, "alice"])?.isInvalidated
      ).toBe(true);
      for (const key of [
        ...keys("bob"),
        ...keys("alice", "crew-b").filter((key) => key[1] !== "task-center"),
      ]) {
        expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
      }
    } finally {
      act(() => root.unmount());
      client.clear();
      mocks.userId = "alice";
      vi.clearAllMocks();
    }
  }
);

it.each(["message", "read", "context", "ready"] as const)(
  "refreshes order caches for the receiving account after %s, but ignores abandoned callbacks",
  async (event) => {
    const client = new QueryClient();
    const root = createRoot(document.createElement("div"));
    const list = orderKeys.list({}, "alice");
    const detail = orderKeys.detail("order-a", "alice");
    const otherDetail = orderKeys.detail("order-b", "alice");
    const otherAccount = [orderKeys.list({}, "bob"), orderKeys.detail("order-a", "bob")];
    const keys = [list, detail, otherDetail, ...otherAccount];
    const reset = () => {
      for (const key of keys) client.setQueryData(key, { fixture: true });
    };
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
      reset();
      await render();
      const handlers = vi.mocked(openConversationRealtime).mock.calls.at(-1)![1];
      const emit = () => {
        if (event === "message")
          handlers.onMessage?.({
            conversationId: "chat",
            lastMessageAt: "2026-01-01T00:00:00Z",
            unreadCount: 1,
            message: {
              id: "message",
              conversationId: "chat",
              body: "",
              createdAt: "2026-01-01T00:00:00Z",
              authorId: null,
              type: "system",
              payload: {
                kind: "system",
                system: { kind: "order.delivered", params: { orderId: "order-a" } },
              },
            },
          } as Parameters<NonNullable<typeof handlers.onMessage>>[0]);
        if (event === "read")
          handlers.onReadAdvanced?.(
            {} as Parameters<NonNullable<typeof handlers.onReadAdvanced>>[0]
          );
        if (event === "context")
          handlers.onContextChanged?.({
            conversationId: "chat",
            from: "service",
            to: "order",
            contextId: "order-a",
          });
        if (event === "ready") handlers.onReady?.();
      };
      await act(async () => emit());
      expect(client.getQueryState(list)?.isInvalidated).toBe(true);
      expect(client.getQueryState(detail)?.isInvalidated).toBe(event !== "read");
      expect(client.getQueryState(otherDetail)?.isInvalidated).toBe(event === "ready");
      for (const key of otherAccount) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      mocks.userId = "bob";
      await render();
      reset();
      const toastCount = vi.mocked(toast).mock.calls.length;
      await act(async () => emit());
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      expect(toast).toHaveBeenCalledTimes(toastCount);
    } finally {
      act(() => root.unmount());
      client.clear();
      mocks.userId = "alice";
      vi.clearAllMocks();
    }
  }
);
