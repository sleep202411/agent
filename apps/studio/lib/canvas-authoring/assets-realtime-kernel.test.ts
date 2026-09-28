import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetEvent } from "@repo/shared";
import type { AssetsRealtimeHandlers } from "./assets-realtime";
const socket = vi.hoisted(() => ({ handlers: [] as AssetsRealtimeHandlers[] }));
vi.mock("./assets-realtime", () => ({
  openAssetsRealtime: vi.fn((handlers: AssetsRealtimeHandlers) => {
    socket.handlers.push(handlers);
    return { close: vi.fn() };
  }),
}));
import { getAssetsRealtimeKernel } from "./assets-realtime-kernel";
const event = (seq: number) => ({ channel: "assets", seq, eventId: `event-${seq}` }) as AssetEvent;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(() => {
  vi.unstubAllGlobals();
  socket.handlers.length = 0;
});

describe("asset replay subscription ownership", () => {
  it("aborts catch-up when the last subscriber leaves", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const kernel = getAssetsRealtimeKernel({ workspaceId: "abort-replay" });
    const sub = kernel.subscribe({ onEvent: vi.fn() });
    socket.handlers[0]!.onEvent!(event(1));
    await flush();
    socket.handlers[0]!.onEvent!(event(3));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    sub.close();
    const options = (fetcher.mock.calls as unknown[][])[0]![1] as RequestInit;
    expect(options.signal?.aborted).toBe(true);
  });

  it("does not deliver an abandoned replay into a reopened subscription", async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      )
    );
    const kernel = getAssetsRealtimeKernel({ workspaceId: "replace-replay" });
    const first = kernel.subscribe({ onEvent: vi.fn() });
    socket.handlers[0]!.onEvent!(event(1));
    await flush();
    socket.handlers[0]!.onEvent!(event(3));
    await flush();
    first.close();
    const receive = vi.fn();
    const second = kernel.subscribe({ onEvent: receive });
    complete(
      new Response(JSON.stringify({ code: 200, data: { events: [event(2)], hasMore: false } }))
    );
    await flush();
    expect(receive).not.toHaveBeenCalled();
    socket.handlers[1]!.onEvent!(event(1));
    await flush();
    expect(receive).toHaveBeenCalledExactlyOnceWith(event(1));
    second.close();
  });
  it("keeps shared catch-up alive and delivers replay before the triggering push", async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
    );
    vi.stubGlobal("fetch", fetcher);
    const kernel = getAssetsRealtimeKernel({ workspaceId: "shared-replay" });
    const first = kernel.subscribe({ onEvent: vi.fn() });
    const receive = vi.fn();
    const second = kernel.subscribe({ onEvent: receive });
    socket.handlers[0]!.onEvent!(event(1));
    await flush();
    socket.handlers[0]!.onEvent!(event(3));
    await flush();
    first.close();
    expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(false);
    complete(
      new Response(JSON.stringify({ code: 200, data: { events: [event(2)], hasMore: false } }))
    );
    await flush();
    expect(receive.mock.calls.map(([e]) => e.seq)).toEqual([1, 2, 3]);
    socket.handlers[0]!.onEvent!(event(2));
    await flush();
    expect(receive).toHaveBeenCalledTimes(3);
    second.close();
  });
});
