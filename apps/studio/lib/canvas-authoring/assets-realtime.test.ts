import { afterEach, describe, expect, it, vi } from "vitest";
import { openAssetsRealtime } from "./assets-realtime";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  send = vi.fn();
  constructor() {
    Socket.instances.push(this);
  }
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Socket.instances = [];
});
const setup = () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: { url: "wss://fixture.invalid", accessToken: "fixture", expiresAt: 1 },
        })
      )
    )
  );
};

describe("asset socket departure", () => {
  it("ignores queued open/message callbacks after close without restarting heartbeat", async () => {
    setup();
    const onEvent = vi.fn();
    const onConnected = vi.fn();
    const client = openAssetsRealtime({ onEvent, onConnected });
    await flush();
    const ws = Socket.instances[0]!;
    const opened = ws.onopen!;
    const message = ws.onmessage!;
    client.close();
    opened();
    message({ data: JSON.stringify({ kind: "media.created" }) });
    expect(onConnected).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an abandoned negotiation request", () => {
    setup();
    const fetcher = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
      () => new Promise(() => {})
    );
    vi.stubGlobal("fetch", fetcher);
    const client = openAssetsRealtime({});
    client.close();
    expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true);
  });
  it("preserves active delivery, heartbeat and reconnect while ignoring the old socket", async () => {
    setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              code: 200,
              data: { url: "wss://fixture.invalid", accessToken: "fixture", expiresAt: 1 },
            })
          )
      )
    );
    const onEvent = vi.fn();
    const onConnected = vi.fn();
    const client = openAssetsRealtime({ onEvent, onConnected });
    await flush();
    const first = Socket.instances[0]!;
    first.onopen!();
    first.onmessage!({ data: JSON.stringify({ kind: "media.created" }) });
    expect(onEvent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(first.send).toHaveBeenCalledTimes(1);
    first.onclose!();
    await vi.advanceTimersByTimeAsync(2_000);
    const replacement = Socket.instances[1]!;
    replacement.onopen!();
    first.onopen!();
    first.onmessage!({ data: JSON.stringify({ kind: "media.created" }) });
    expect(onConnected).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    client.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start a heartbeat when the connected callback closes the client", async () => {
    setup();
    const client = openAssetsRealtime({ onConnected: () => client.close() });
    await flush();
    Socket.instances[0]!.onopen!();
    expect(vi.getTimerCount()).toBe(0);
  });
});
