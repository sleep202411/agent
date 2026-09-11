import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { fetchUnreadCount, listNotifications } from "./api";
import {
  notificationKeys,
  useRecentNotifications,
  useUnreadCount,
  useNotificationFeed,
} from "./hooks";

const session = vi.hoisted(() => ({ userId: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.userId ? { id: session.userId } : null }),
}));
vi.mock("./api", () => ({ listNotifications: vi.fn(), fetchUnreadCount: vi.fn() }));
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
