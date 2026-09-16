import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openQuotaClient } from "./quota/quota-client";
import { openEntityEventsClient } from "./entity-events/entity-events-client";
import { openChatEventsClient } from "./assistant/chat-events-client";
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  constructor(readonly url: string) {
    Socket.instances.push(this);
  }
  addEventListener(name: string, listener: (event: Record<string, unknown>) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  emit(name: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
  close = vi.fn();
}
const clients = [
  {
    name: "quota",
    open: (onEvent: () => void, onOpen: () => void) =>
      openQuotaClient({ onUpdate: onEvent, onOpen }),
    frame: { event: "quota_updated", data: {} },
  },
  {
    name: "entities",
    open: (onEvent: () => void, onOpen: () => void) =>
      openEntityEventsClient({ onEntityChanged: onEvent, onOpen }),
    frame: { event: "entity_changed", data: {} },
  },
  {
    name: "chat",
    open: (onEvent: () => void, onOpen: () => void) =>
      openChatEventsClient("conversation", { onFrame: onEvent, onOpen }),
    frame: { event: "message_list", data: { messageIds: [] } },
  },
];
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = "satoken=; Max-Age=0; path=/";
});
it.each(clients)("ignores abandoned $name events after close", ({ open, frame }) => {
  const onEvent = vi.fn();
  const onOpen = vi.fn();
  const client = open(onEvent, onOpen);
  const sock = Socket.instances[0]!;
  client.close();
  sock.emit("open");
  sock.emit("message", { data: JSON.stringify(frame) });
  expect(onOpen).not.toHaveBeenCalled();
  expect(onEvent).not.toHaveBeenCalled();
});
it.each(clients)("keeps the replacement $name socket when old events arrive", ({ open, frame }) => {
  const onEvent = vi.fn();
  const client = open(onEvent, vi.fn());
  const old = Socket.instances[0]!;
  old.emit("close", { code: 1006, reason: "lost" });
  vi.advanceTimersByTime(500);
  const replacement = Socket.instances[1]!;
  replacement.emit("open");
  old.emit("message", { data: JSON.stringify(frame) });
  old.emit("close", { code: 1006, reason: "late" });
  expect(onEvent).not.toHaveBeenCalled();
  expect(client.isOpen).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(Socket.instances).toHaveLength(2);
  client.close();
});
it.each(clients)("does not log credential prefixes for $name", ({ open }) => {
  document.cookie = "satoken=secret-prefix-value; path=/";
  const client = open(vi.fn(), vi.fn());
  Socket.instances[0]!.emit("open");
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("secret-p");
  client.close();
});
it.each(clients)(
  "delivers active $name frames and retries transient closure",
  ({ open, frame }) => {
    const onEvent = vi.fn();
    const onOpen = vi.fn();
    const client = open(onEvent, onOpen);
    Socket.instances[0]!.emit("open");
    Socket.instances[0]!.emit("message", { data: JSON.stringify(frame) });
    expect(onEvent).toHaveBeenCalledTimes(1);
    Socket.instances[0]!.emit("close", { code: 1006, reason: "lost" });
    vi.advanceTimersByTime(499);
    expect(Socket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    Socket.instances[1]!.emit("open");
    Socket.instances[1]!.emit("message", { data: JSON.stringify(frame) });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledTimes(2);
    client.close();
  }
);
it.each(clients)("does not reconnect $name after a fatal close", ({ open }) => {
  const client = open(vi.fn(), vi.fn());
  Socket.instances[0]!.emit("close", { code: 4001, reason: "expired" });
  vi.advanceTimersByTime(60_000);
  expect(Socket.instances).toHaveLength(1);
  client.close();
});
