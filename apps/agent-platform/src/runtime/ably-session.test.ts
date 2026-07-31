import { describe, expect, it, vi } from "vitest";

import type Ably from "ably";

import { AgentAblyClientPool, connectAgentSession } from "./ably-session.js";

describe("connectAgentSession", () => {
  it("starts the Ably client before attaching the AI Transport session", async () => {
    const calls: string[] = [];
    const client = {
      connect: vi.fn(() => {
        calls.push("client.connect");
      }),
    };
    const session = {
      connect: vi.fn(async () => {
        calls.push("session.connect");
      }),
    };

    await connectAgentSession(client, session);

    expect(calls).toEqual(["client.connect", "session.connect"]);
  });

  it("propagates an AI Transport attach failure", async () => {
    const expected = new Error("channel attach failed");
    const client = { connect: vi.fn() };
    const session = { connect: vi.fn().mockRejectedValue(expected) };

    await expect(connectAgentSession(client, session)).rejects.toBe(expected);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });
});

describe("AgentAblyClientPool", () => {
  it("reuses one healthy Realtime connection across worker Activities", () => {
    const first = fakeClient("initialized");
    const factory = vi.fn(() => first.client);
    const pool = new AgentAblyClientPool(factory);

    expect(pool.acquire("app.key:secret")).toBe(first.client);
    expect(pool.acquire("app.key:secret")).toBe(first.client);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.close).not.toHaveBeenCalled();
  });

  it.each(["failed", "closing", "closed"] as const)(
    "replaces a client in terminal %s state",
    (terminalState) => {
      const first = fakeClient("connected");
      const second = fakeClient("initialized");
      const factory = vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(second.client);
      const pool = new AgentAblyClientPool(factory);

      expect(pool.acquire("app.key:secret")).toBe(first.client);
      first.connection.state = terminalState;
      expect(pool.acquire("app.key:secret")).toBe(second.client);
      expect(first.close).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledTimes(2);
    }
  );

  it("rotates the client when the configured credential changes", () => {
    const first = fakeClient("connected");
    const second = fakeClient("initialized");
    const factory = vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(second.client);
    const pool = new AgentAblyClientPool(factory);

    expect(pool.acquire("first.key:secret")).toBe(first.client);
    expect(pool.acquire("second.key:secret")).toBe(second.client);
    expect(first.close).toHaveBeenCalledTimes(1);
  });
});

function fakeClient(initialState: "initialized" | "connected" | "failed" | "closing" | "closed") {
  const connection = { state: initialState };
  const close = vi.fn();
  return {
    connection,
    close,
    client: {
      connection,
      close,
    } as unknown as Ably.Realtime,
  };
}
