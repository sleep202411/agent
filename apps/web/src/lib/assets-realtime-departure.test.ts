import { afterEach, describe, expect, it, vi } from "vitest";
import { openAssetsRealtime as openWorkspace } from "../../app/(fizzstudio)/_lib/assets-realtime";
import { openAssetsRealtime as openImages } from "../../app/(studio)/art-studio/image/_data/assets-realtime";

const azure = vi.hoisted(() => ({
  listeners: new Map<string, (value: unknown) => void>(),
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
}));
vi.mock("@azure/web-pubsub-client", () => ({
  WebPubSubClient: class {
    on(name: string, callback: (value: unknown) => void) {
      azure.listeners.set(name, callback);
    }
    start = azure.start;
    stop = azure.stop;
  },
}));

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
          data: {
            transport: "self-hosted",
            url: "wss://fixture.invalid",
            accessToken: "fixture",
            expiresAt: 1,
          },
        })
      )
    )
  );
};

describe.each([
  ["workspace", openWorkspace],
  ["image", openImages],
] as const)("%s asset socket departure", (_name, openAssetsRealtime) => {
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
              data: {
                transport: "self-hosted",
                url: "wss://fixture.invalid",
                accessToken: "fixture",
                expiresAt: 1,
              },
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

  it("keeps active PubSub messages and suppresses messages after departure", async () => {
    setup();
    azure.listeners.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              code: 200,
              data: {
                transport: "web-pubsub",
                url: "wss://fixture.invalid",
                accessToken: "fixture",
              },
            })
          )
      )
    );
    const onEvent = vi.fn();
    const client = openAssetsRealtime({ onEvent });
    await vi.waitFor(() => expect(azure.listeners.has("group-message")).toBe(true));
    const message = azure.listeners.get("group-message")!;
    message({ message: { data: { kind: "media.created" } } });
    expect(onEvent).toHaveBeenCalledTimes(1);
    client.close();
    message({ message: { data: { kind: "media.created" } } });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
  it("does not start a heartbeat when the connected callback closes the client", async () => {
    setup();
    const client = openAssetsRealtime({ onConnected: () => client.close() });
    await flush();
    Socket.instances[0]!.onopen!();
    expect(vi.getTimerCount()).toBe(0);
  });
});
