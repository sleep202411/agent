import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { listNotifications } from "./api";
import { notificationKeys, useRecentNotifications } from "./hooks";

vi.mock("./api", () => ({ listNotifications: vi.fn() }));
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
    expect(client.getQueryData([...notificationKeys.list, 10])).toEqual(updated);
  } finally {
    act(() => root.unmount());
    client.clear();
    host.remove();
    focusManager.setFocused(undefined);
    vi.useRealTimers();
    vi.resetAllMocks();
  }
});
