// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  STUDIO_AGENT_REALTIME_UNAVAILABLE_MESSAGE,
  StudioAgentRealtimeError,
  type StudioAgentRealtimeGrant,
} from "./realtime-grant";
import {
  useStudioAgentRealtime,
  type StudioAgentRealtimeHandle,
} from "./use-studio-agent-realtime";

/**
 * The connection, and only the connection.
 *
 * `@ably/ai-transport` owns the conversation; this hook owns the socket under
 * it — when it is opened, when it is released, and what the surface is told
 * while it is neither. Reconnection itself is Ably's, so what is asserted here
 * is that the hook reports it honestly and never leaks a connection: an idle
 * one still counts against the account's concurrent ceiling.
 */
const ably = vi.hoisted(() => {
  type ConnectionListener = (change: { current: string; reason?: { message: string } }) => void;

  class MockRealtime {
    static instances: MockRealtime[] = [];
    readonly options: { authCallback: unknown };
    readonly listeners: ConnectionListener[] = [];
    closed = false;
    readonly connection = {
      on: (listener: ConnectionListener) => {
        this.listeners.push(listener);
      },
    };

    constructor(options: { authCallback: unknown }) {
      this.options = options;
      MockRealtime.instances.push(this);
    }

    close() {
      this.closed = true;
    }

    emit(current: string, reason?: { message: string }) {
      for (const listener of this.listeners) listener({ current, reason });
    }
  }

  return { MockRealtime };
});

vi.mock("ably", () => ({ Realtime: ably.MockRealtime }));

const THREAD_ID = "00000000-0000-4000-8000-000000000001";
const CHANNEL = `agent:v1:conversation:${THREAD_ID}`;

describe("useStudioAgentRealtime", () => {
  let container: HTMLDivElement;
  let root: Root;
  let handle: StudioAgentRealtimeHandle | null;
  let authorize: Mock<() => Promise<StudioAgentRealtimeGrant>>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    ably.MockRealtime.instances.length = 0;
    handle = null;
    authorize = vi.fn<() => Promise<StudioAgentRealtimeGrant>>().mockResolvedValue(grant());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("spends nothing while the creator is not looking at StoryOS", async () => {
    await render({ threadId: THREAD_ID, enabled: false });

    expect(authorize).not.toHaveBeenCalled();
    expect(ably.MockRealtime.instances).toHaveLength(0);
    expect(handle).toEqual({ client: null, channelName: null, status: "idle", error: null });
  });

  it("reports connecting from the first render, before the grant resolves", async () => {
    let release: ((value: StudioAgentRealtimeGrant) => void) | null = null;
    authorize.mockReturnValue(
      new Promise<StudioAgentRealtimeGrant>((resolve) => {
        release = resolve;
      })
    );

    await render({ threadId: THREAD_ID, enabled: true });
    expect(handle?.status).toBe("connecting");
    expect(handle?.client).toBeNull();

    await act(async () => {
      release!(grant());
      await settle();
    });
    expect(handle?.channelName).toBe(CHANNEL);
  });

  it("opens on the channel the server signed, never one it rebuilt", async () => {
    const secondId = "00000000-0000-4000-8000-000000000002";
    authorize.mockResolvedValue(
      grant({
        conversation: {
          ...grant().conversation,
          id: secondId,
        },
        sessionName: `agent:v1:conversation:${secondId}`,
      })
    );

    await render({ threadId: THREAD_ID, enabled: true });

    expect(handle?.channelName).toBe(`agent:v1:conversation:${secondId}`);
    expect(handle?.client).toBe(ably.MockRealtime.instances[0]);
  });

  it("follows the socket through a drop and back, so the panel never lies about the pipe", async () => {
    await render({ threadId: THREAD_ID, enabled: true });
    const client = ably.MockRealtime.instances[0]!;

    await emit(client, "connected");
    expect(handle?.status).toBe("connected");

    await emit(client, "disconnected");
    expect(handle?.status).toBe("reconnecting");

    // Ably reconnects and replays what it missed; the hook has no catch-up of
    // its own to run, so recovery is nothing but this status going back.
    await emit(client, "connected");
    expect(handle).toMatchObject({ status: "connected", error: null, channelName: CHANNEL });
  });

  it("states a terminal connection failure instead of spinning forever", async () => {
    await render({ threadId: THREAD_ID, enabled: true });
    const client = ably.MockRealtime.instances[0]!;

    await emit(client, "failed", { message: "Token capability rejected." });

    expect(handle?.status).toBe("closed");
    expect(handle?.error?.message).toBe(STUDIO_AGENT_REALTIME_UNAVAILABLE_MESSAGE);
    expect(handle?.error?.message).not.toContain("Token capability");
  });

  it("surfaces a refused grant as a closed pipe rather than an endless connect", async () => {
    authorize.mockRejectedValue(new StudioAgentRealtimeError("No access to this thread.", true));

    await render({ threadId: THREAD_ID, enabled: true });

    expect(handle?.status).toBe("closed");
    expect(handle?.error?.message).toBe("No access to this thread.");
    expect(ably.MockRealtime.instances).toHaveLength(0);
  });

  it("closes the connection when the panel closes, and reports idle again", async () => {
    await render({ threadId: THREAD_ID, enabled: true });
    const client = ably.MockRealtime.instances[0]!;
    await emit(client, "connected");
    expect(handle?.status).toBe("connected");

    await render({ threadId: THREAD_ID, enabled: false });

    expect(client.closed).toBe(true);
    // Derived, not reset: a closed client must not survive in the handle, or
    // `<AblyProvider>` would be handed a socket nobody is holding open.
    expect(handle).toEqual({ client: null, channelName: null, status: "idle", error: null });
  });

  it("does not carry one thread's connection into the next", async () => {
    await render({ threadId: THREAD_ID, enabled: true });
    const first = ably.MockRealtime.instances[0]!;
    await emit(first, "connected");

    const secondId = "00000000-0000-4000-8000-000000000002";
    authorize.mockResolvedValue(
      grant({
        conversation: {
          ...grant().conversation,
          id: secondId,
        },
        sessionName: `agent:v1:conversation:${secondId}`,
      })
    );
    await render({ threadId: "00000000-0000-4000-8000-000000000002", enabled: true });

    expect(first.closed).toBe(true);
    expect(handle?.channelName).toBe(`agent:v1:conversation:${secondId}`);
    expect(handle?.client).toBe(ably.MockRealtime.instances[1]);
  });

  it("keeps a live connection when only the authorize closure changes identity", async () => {
    await render({ threadId: THREAD_ID, enabled: true });
    const client = ably.MockRealtime.instances[0]!;

    // A parent re-render mints a new callback on every pass; tearing the socket
    // down for that would reconnect the creator continuously.
    authorize = vi.fn<() => Promise<StudioAgentRealtimeGrant>>().mockResolvedValue(grant());
    await render({ threadId: THREAD_ID, enabled: true });

    expect(ably.MockRealtime.instances).toHaveLength(1);
    expect(client.closed).toBe(false);
  });

  it("hands the opening grant to the SDK's first auth callback instead of minting a second", async () => {
    await render({ threadId: THREAD_ID, enabled: true });
    const client = ably.MockRealtime.instances[0]!;
    expect(authorize).toHaveBeenCalledTimes(1);

    const authCallback = client.options.authCallback as (
      params: unknown,
      callback: (error: string | null, token: unknown) => void
    ) => void;
    const first = vi.fn();
    await act(async () => {
      authCallback({}, first);
      await settle();
    });

    // The opening JWT is consumed here; only a renewal asks the product gateway
    // to re-authorize the conversation and mint another one.
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(null, grant().ablyToken);

    const renewal = vi.fn();
    await act(async () => {
      authCallback({}, renewal);
      await settle();
    });
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  async function render(props: { threadId: string | null; enabled: boolean }) {
    await act(async () => {
      root.render(
        <Harness
          threadId={props.threadId}
          enabled={props.enabled}
          authorize={() => authorize()}
          onHandle={(value) => {
            handle = value;
          }}
        />
      );
      await settle();
    });
  }

  async function emit(
    client: InstanceType<typeof ably.MockRealtime>,
    state: string,
    reason?: { message: string }
  ) {
    await act(async () => {
      client.emit(state, reason);
      await settle();
    });
  }
});

function Harness({
  threadId,
  enabled,
  authorize,
  onHandle,
}: {
  threadId: string | null;
  enabled: boolean;
  authorize: () => Promise<StudioAgentRealtimeGrant>;
  onHandle: (handle: StudioAgentRealtimeHandle) => void;
}) {
  onHandle(useStudioAgentRealtime({ threadId, enabled, authorize }));
  return null;
}

function grant(overrides: Partial<StudioAgentRealtimeGrant> = {}): StudioAgentRealtimeGrant {
  return {
    schemaVersion: "agent-conversation-grant/v1",
    conversation: {
      id: THREAD_ID,
      surface: "story-studio",
      title: null,
      permissionMode: "smart",
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
      archivedAt: null,
    },
    sessionName: CHANNEL,
    ablyToken: "jwt.header.signature",
    expiresAt: "2099-07-30T11:00:00.000Z",
    ...overrides,
  };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
