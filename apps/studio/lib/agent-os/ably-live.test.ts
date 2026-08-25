import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentOsApi } from "./api-client";

const ably = vi.hoisted(() => {
  type OnceHandler = () => void;
  type StateHandler = (change: { current: string }) => void;

  class FakeConnection {
    private readonly onceHandlers = new Map<string, OnceHandler[]>();
    private readonly stateHandlers: StateHandler[] = [];

    once(state: string, handler: OnceHandler): void {
      this.onceHandlers.set(state, [...(this.onceHandlers.get(state) ?? []), handler]);
    }

    on(handler: StateHandler): void {
      this.stateHandlers.push(handler);
    }

    emit(state: string): void {
      const handlers = this.onceHandlers.get(state) ?? [];
      this.onceHandlers.delete(state);
      for (const handler of handlers) handler();
      for (const handler of this.stateHandlers) handler({ current: state });
    }
  }

  class FakeChannel {
    on(): void {}
    subscribe(): void {}
  }

  class FakeRealtime {
    static readonly instances: FakeRealtime[] = [];
    readonly connection = new FakeConnection();
    readonly channels = { get: () => new FakeChannel() };
    closed = false;

    constructor() {
      FakeRealtime.instances.push(this);
    }

    close(): void {
      this.closed = true;
    }
  }

  return { FakeRealtime };
});

vi.mock("ably", () => ({ Realtime: ably.FakeRealtime }));

import { AgentOsAblyLive, type AgentOsLiveHandlers } from "./ably-live";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_A = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_B = "33333333-3333-4333-8333-333333333333";

const handlers: AgentOsLiveHandlers = {
  onEvent: () => undefined,
  onSnapshot: () => undefined,
  onResync: () => undefined,
  onDiscontinuity: () => undefined,
};

describe("AgentOsAblyLive attach fencing", () => {
  beforeEach(() => {
    ably.FakeRealtime.instances.length = 0;
    vi.spyOn(agentOsApi, "realtimeToken").mockImplementation(async (_projectId, conversationId) =>
      tokenGrant(conversationId)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps conversation B live when conversation A fails after B connected", async () => {
    const live = new AgentOsAblyLive();
    const attachA = live.attach({
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_A,
      handlers,
    });
    await waitForInstances(1);
    const clientA = ably.FakeRealtime.instances[0]!;

    const attachB = live.attach({
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_B,
      handlers,
    });
    await waitForInstances(2);
    const clientB = ably.FakeRealtime.instances[1]!;
    clientB.connection.emit("connected");
    await expect(attachB).resolves.toBe(true);

    clientA.connection.emit("failed");
    await expect(attachA).resolves.toBe(false);
    expect(clientA.closed).toBe(true);
    expect(clientB.closed).toBe(false);
    expect(live.isLive).toBe(true);
    live.detach();
  });

  it("keeps conversation B live when conversation A connects late", async () => {
    const live = new AgentOsAblyLive();
    const attachA = live.attach({
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_A,
      handlers,
    });
    await waitForInstances(1);
    const clientA = ably.FakeRealtime.instances[0]!;

    const attachB = live.attach({
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_B,
      handlers,
    });
    await waitForInstances(2);
    const clientB = ably.FakeRealtime.instances[1]!;
    clientB.connection.emit("connected");
    await expect(attachB).resolves.toBe(true);

    clientA.connection.emit("connected");
    await expect(attachA).resolves.toBe(false);
    expect(clientA.closed).toBe(true);
    expect(clientB.closed).toBe(false);
    expect(live.isLive).toBe(true);
    live.detach();
  });

  it("invalidates an in-flight attach when explicitly detached", async () => {
    const live = new AgentOsAblyLive();
    const attaching = live.attach({
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_A,
      handlers,
    });
    await waitForInstances(1);
    const client = ably.FakeRealtime.instances[0]!;

    live.detach();
    client.connection.emit("connected");

    await expect(attaching).resolves.toBe(false);
    expect(client.closed).toBe(true);
    expect(live.isLive).toBe(false);
  });
});

async function waitForInstances(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(ably.FakeRealtime.instances).toHaveLength(count);
  });
}

function tokenGrant(conversationId: string) {
  return {
    channel: `private:agent-os:conversation:${conversationId}`,
    ttlMs: 60_000,
    tokenRequest: {
      keyName: "app.key",
      clientId: "user:test",
      capability: "{}",
      timestamp: 1,
      nonce: "nonce",
      mac: "mac",
      ttl: 60_000,
    },
  };
}
