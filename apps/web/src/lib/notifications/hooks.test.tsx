import { act } from "react";
import { toast } from "sonner";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import {
  fetchUnreadCount,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "./api";
import {
  useMarkRead,
  useMarkAllRead,
  notificationKeys,
  useRecentNotifications,
  useUnreadCount,
  useNotificationFeed,
} from "./hooks";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const session = vi.hoisted(() => ({ userId: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.userId ? { id: session.userId } : null }),
}));
vi.mock("./api", () => ({
  listNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("recovers recent notifications after a missed realtime push", async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Probe() {
    useRecentNotifications();
    return null;
  }
  try {
    vi.mocked(listNotifications).mockResolvedValueOnce({ items: [], nextCursor: null });
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
    expect(listNotifications).toHaveBeenCalledTimes(1);
    const updated = { items: [{ id: "new-assignment" }], nextCursor: null };
    vi.mocked(listNotifications).mockResolvedValue(
      updated as Awaited<ReturnType<typeof listNotifications>>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(client.getQueryData([...notificationKeys.list, "alice", 10])).toEqual(updated);
  } finally {
    act(() => root.unmount());
    client.clear();
    host.remove();
    focusManager.setFocused(undefined);
    vi.useRealTimers();
    vi.resetAllMocks();
  }
});

it("isolates the bell, count and inbox across logout and an account switch", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  let pending!: (value: Awaited<ReturnType<typeof listNotifications>>) => void;
  let countPending!: (value: { count: number }) => void;
  vi.mocked(listNotifications).mockResolvedValue({
    items: [{ id: "alice-private" }],
    nextCursor: null,
  } as Awaited<ReturnType<typeof listNotifications>>);
  vi.mocked(fetchUnreadCount).mockResolvedValue({ count: 7 });
  function Probe() {
    const recent = useRecentNotifications();
    const count = useUnreadCount();
    const feed = useNotificationFeed();
    return <div>{JSON.stringify({ recent: recent.data, count: count.data, feed: feed.data })}</div>;
  }
  const render = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
  };
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  try {
    session.userId = "alice";
    await render();
    await settle();
    expect(host.textContent).toContain("alice-private");
    const oldCalls = vi.mocked(listNotifications).mock.calls.length;
    session.userId = null;
    await render();
    await settle();
    expect(host.textContent).not.toContain("alice-private");
    expect(host.textContent).not.toContain('"count":7');
    expect(listNotifications).toHaveBeenCalledTimes(oldCalls);
    const nextPage = new Promise<Awaited<ReturnType<typeof listNotifications>>>((resolve) => {
      pending = resolve;
    });
    vi.mocked(listNotifications).mockReturnValue(nextPage);
    vi.mocked(fetchUnreadCount).mockReturnValue(
      new Promise((resolve) => {
        countPending = resolve;
      })
    );
    session.userId = "bob";
    await render();
    await settle();
    expect(host.textContent).not.toContain("alice-private");
    expect(host.textContent).not.toContain('"count":7');
    await act(async () => {
      pending({ items: [{ id: "bob-private" }], nextCursor: null } as Awaited<
        ReturnType<typeof listNotifications>
      >);
      countPending({ count: 2 });
    });
    await settle();
    expect(host.textContent).toContain("bob-private");
    expect(host.textContent).toContain('"count":2');
    expect(host.textContent).not.toContain("alice-private");
  } finally {
    act(() => root.unmount());
    client.clear();
    session.userId = "alice";
    vi.resetAllMocks();
  }
});

it.each(["one", "all"] as const)(
  "keeps delayed mark-read (%s) refreshes with the initiating account",
  async (mode) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const host = document.createElement("div");
    const root = createRoot(host);
    const keys = (account: string | null) => [
      [...notificationKeys.unreadCount, account],
      [...notificationKeys.list, account, 10],
      [...notificationKeys.list, account, 20],
      [...notificationKeys.feed, account, 30, "all"],
      [...notificationKeys.feed, account, 30, "unread"],
    ];
    for (const account of ["alice", "bob", null]) {
      for (const key of keys(account)) client.setQueryData(key, { retained: true });
    }
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    vi.mocked(markNotificationRead).mockImplementation(async () => {
      await pending;
      return { id: "notification" } as Awaited<ReturnType<typeof markNotificationRead>>;
    });
    vi.mocked(markAllNotificationsRead).mockImplementation(async () => {
      await pending;
      return { count: 1 };
    });
    let submit!: () => Promise<unknown>;
    function Probe() {
      const one = useMarkRead();
      const all = useMarkAllRead();
      submit = () => (mode === "one" ? one.mutateAsync("notification") : all.mutateAsync());
      return null;
    }
    const render = async () => {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        )
      );
    };
    try {
      session.userId = "alice";
      await render();
      let result!: Promise<unknown>;
      await act(async () => {
        result = submit();
      });
      session.userId = "bob";
      await render();
      await act(async () => {
        resolve();
        await result;
      });
      for (const key of keys("alice")) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      for (const account of ["bob", null]) {
        for (const key of keys(account))
          expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      }
    } finally {
      act(() => root.unmount());
      client.clear();
      session.userId = "alice";
      vi.resetAllMocks();
    }
  }
);

it("cancels abandoned notification reads on account switch", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  const root = createRoot(host);
  const signals: AbortSignal[] = [];
  vi.mocked(listNotifications).mockImplementation((_opts, signal?: AbortSignal) => {
    if (signal) signals.push(signal);
    return new Promise(() => undefined);
  });
  vi.mocked(fetchUnreadCount).mockImplementation((signal?: AbortSignal) => {
    if (signal) signals.push(signal);
    return new Promise(() => undefined);
  });
  function Probe() {
    useRecentNotifications();
    useUnreadCount();
    useNotificationFeed();
    return null;
  }
  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
  try {
    session.userId = "alice";
    await render();
    expect(signals).toHaveLength(3);
    const original = [...signals];
    session.userId = "bob";
    await render();
    expect(original.every((signal) => signal.aborted)).toBe(true);
    expect(signals.slice(3).every((signal) => !signal.aborted)).toBe(true);
  } finally {
    act(() => root.unmount());
    client.clear();
    session.userId = "alice";
    vi.resetAllMocks();
  }
});

it.each(["switch", "unmount", "current"])(
  "handles a delayed mark-read failure after %s",
  async (change) => {
    const client = new QueryClient();
    const root = createRoot(document.createElement("div"));
    let reject!: (error: Error) => void;
    vi.mocked(markAllNotificationsRead).mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    let submit!: () => Promise<unknown>;
    function Probe() {
      const mutation = useMarkAllRead();
      submit = () => mutation.mutateAsync().catch(() => undefined);
      return null;
    }
    const render = () =>
      act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>
        )
      );
    let unmounted = false;
    try {
      session.userId = "alice";
      await render();
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = submit();
      });
      if (change === "switch") {
        session.userId = "bob";
        await render();
      }
      if (change === "unmount") {
        act(() => root.unmount());
        unmounted = true;
      }
      await act(async () => {
        reject(new Error("Account-specific failure"));
        await pending;
      });
      if (change === "current")
        expect(toast.error).toHaveBeenCalledWith("Account-specific failure");
      else expect(toast.error).not.toHaveBeenCalled();
    } finally {
      if (!unmounted) act(() => root.unmount());
      client.clear();
      session.userId = "alice";
      vi.resetAllMocks();
    }
  }
);
