import { beforeEach, describe, expect, it, vi } from "vitest";

const ably = vi.hoisted(() => {
  const channel = {
    state: "attached",
    subscribe: vi.fn(),
    on: vi.fn(),
    attach: vi.fn<() => Promise<void>>(),
    unsubscribe: vi.fn(),
    detach: vi.fn<() => Promise<void>>(),
  };
  return {
    channel,
    connectionOn: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  };
});

vi.mock("ably", () => ({
  Realtime: class {
    channels = { get: () => ably.channel };
    connection = { on: ably.connectionOn };
    connect = ably.connect;
    close = ably.close;
  },
  ErrorInfo: class extends Error {
    statusCode = 500;
  },
}));

import { openConversationRealtime } from "./ably-client";

describe("openConversationRealtime teardown", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    ably.channel.attach.mockResolvedValue();
    ably.channel.detach.mockResolvedValue();
  });

  it("unsubscribes and closes the owning realtime connection exactly once", () => {
    const client = openConversationRealtime("user-1", {});

    client.close();
    client.close();

    expect(ably.channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(ably.channel.detach).not.toHaveBeenCalled();
    expect(ably.close).toHaveBeenCalledTimes(1);
  });

  it("still closes the connection when the channel is already disposed", () => {
    ably.channel.unsubscribe.mockImplementation(() => {
      throw new Error("already disposed");
    });
    const client = openConversationRealtime("user-1", {});

    expect(() => client.close()).not.toThrow();
    expect(ably.close).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["message.created", "onMessage"],
    ["read.advanced", "onReadAdvanced"],
    ["context.changed", "onContextChanged"],
    ["crew.task.changed", "onCrewTaskChanged"],
    ["crew.task.project.changed", "onCrewTaskProjectChanged"],
    ["crew.asset.changed", "onCrewAssetChanged"],
    ["notification.created", "onNotification"],
    ["terminate", "onTerminate"],
  ] as const)("ignores queued %s frames after the owning client closes", (event, handler) => {
    const receive = vi.fn();
    const client = openConversationRealtime("alice", { [handler]: receive });
    const deliver = ably.channel.subscribe.mock.calls[0][1] as (message: { data: unknown }) => void;
    const frame = { data: { event, data: { reason: "closed", code: 403 } } };
    deliver(frame);
    expect(receive).toHaveBeenCalledTimes(1);
    client.close();
    const otherReceive = vi.fn();
    const otherClient = openConversationRealtime("bob", { [handler]: otherReceive });
    deliver(frame);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(otherReceive).not.toHaveBeenCalled();
    otherClient.close();
  });

  it("reports closed immediately even before the SDK channel state changes", () => {
    const client = openConversationRealtime("alice", {});
    expect(client.isOpen).toBe(true);
    client.close();
    expect(client.isOpen).toBe(false);
  });
});
