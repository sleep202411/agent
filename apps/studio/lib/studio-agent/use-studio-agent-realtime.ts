"use client";

import { useEffect, useRef, useState } from "react";
import type { Realtime } from "ably";

import {
  StudioAgentRealtimeError,
  studioAgentRealtimeUnavailableError,
  type StudioAgentRealtimeGrant,
} from "./realtime-grant";

/** Connection state as the surface reports it. `closed` is terminal. */
export type StudioAgentStreamStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface StudioAgentRealtimeHandle {
  /** The Ably client for `<AblyProvider>`, or `null` until the grant resolves. */
  client: Realtime | null;
  /** The server-chosen conversation channel, or `null` until the grant resolves. */
  channelName: string | null;
  status: StudioAgentStreamStatus;
  error: Error | null;
}

/**
 * One connection's observable state, tagged with the thread it belongs to.
 *
 * The tag makes reading safe while another scope's state lingers: state whose
 * `key` is not the current one is simply not read. It is NOT enough on its own,
 * because a scope can come back — close the panel, reopen the same thread — and
 * its own dead state would match the key again. So teardown also clears the
 * slot: a closed client must be unreachable, not merely unread.
 */
interface StudioAgentConnectionState {
  key: string;
  client: Realtime | null;
  channelName: string | null;
  status: StudioAgentStreamStatus;
  error: Error | null;
}

/**
 * Own the Ably connection for one thread.
 *
 * One connection and one channel per subscribed thread, and the account is
 * capped on both, so this is gated by `enabled` — a creator who never opens
 * StoryOS spends neither, and never downloads the SDK either (it is imported
 * dynamically).
 *
 * Reconnection, backoff and the replay of anything published while the socket
 * was away are Ably's; a subscriber that rejoins mid-stream receives the
 * accumulated content of the message being appended to rather than an empty
 * buffer. There is no catch-up loop here because there is nothing left for one
 * to do.
 */
export function useStudioAgentRealtime({
  threadId,
  enabled,
  initialGrant,
  authorize,
}: {
  threadId: string | null;
  enabled: boolean;
  /** Grant returned while resolving the conversation; consumed once. */
  initialGrant?: StudioAgentRealtimeGrant | null;
  /** Mints a grant. Called to open the connection and again for every renewal. */
  authorize: () => Promise<StudioAgentRealtimeGrant>;
}): StudioAgentRealtimeHandle {
  const key = enabled && threadId ? threadId : null;
  const [state, setState] = useState<StudioAgentConnectionState | null>(null);
  // Read through a ref so a re-created `authorize` closure never tears down a
  // live connection: the identity that matters is the thread, not the callback.
  const authorizeRef = useRef(authorize);
  const initialGrantRef = useRef(initialGrant);
  useEffect(() => {
    authorizeRef.current = authorize;
  }, [authorize]);
  useEffect(() => {
    initialGrantRef.current = initialGrant;
  }, [initialGrant]);

  useEffect(() => {
    if (!key) return;

    let released = false;
    let client: Realtime | null = null;
    /** The grant that opened the connection, consumed before the first renewal. */
    let seeded: StudioAgentRealtimeGrant | null = null;

    /** Merge into this thread's slot, replacing any other thread's. */
    const publish = (patch: Partial<Omit<StudioAgentConnectionState, "key">>) => {
      if (released) return;
      setState((current) =>
        current?.key === key
          ? { ...current, ...patch }
          : {
              key,
              client: null,
              channelName: null,
              status: "connecting",
              error: null,
              ...patch,
            }
      );
    };

    void (async () => {
      try {
        const candidate = initialGrantRef.current;
        const grant =
          candidate && Date.parse(candidate.expiresAt) > Date.now() + 30_000
            ? candidate
            : await authorizeRef.current();
        if (released) return;
        seeded = grant;
        const { Realtime: AblyRealtime } = await import("ably");
        if (released) return;

        client = new AblyRealtime({
          authCallback: (_tokenParams, callback) => {
            const pending = seeded ? Promise.resolve(seeded) : authorizeRef.current();
            seeded = null;
            pending.then(
              (next) => callback(null, next.ablyToken),
              (cause: unknown) => callback(toMessage(cause), null)
            );
          },
        });

        client.connection.on((change) => {
          switch (change.current) {
            case "initialized":
            case "connecting":
              publish({ status: "connecting" });
              return;
            case "connected":
              publish({ status: "connected", error: null });
              return;
            case "disconnected":
            case "suspended":
              publish({ status: "reconnecting" });
              return;
            case "failed":
              publish({
                status: "closed",
                error: studioAgentRealtimeUnavailableError(),
              });
              return;
            default:
              return;
          }
        });

        publish({ client, channelName: grant.sessionName });
      } catch (cause) {
        publish({
          status: "closed",
          error:
            cause instanceof StudioAgentRealtimeError
              ? cause
              : studioAgentRealtimeUnavailableError(),
        });
      }
    })();

    return () => {
      released = true;
      seeded = null;
      // An idle connection still counts against the account's concurrent
      // connection ceiling, so releasing means closing.
      client?.close();
      client = null;
      // The slot dies with the connection. If the same thread is re-enabled
      // (the creator closes StoryOS and reopens it), a lingering entry would
      // match the key again and hand `<AblyProvider>` this closed client for
      // the whole window in which the next effect is still minting its grant —
      // the transport then opens a session on a dead socket and latches
      // "realtime unavailable" over a conversation that is actually fine.
      setState((current) => (current?.key === key ? null : current));
    };
  }, [key]);

  // Anything belonging to another thread — or to a panel that has since been
  // closed — is simply not this handle's state.
  const current = state?.key === key ? state : null;
  return {
    client: current?.client ?? null,
    channelName: current?.channelName ?? null,
    status: key === null ? "idle" : (current?.status ?? "connecting"),
    error: current?.error ?? null,
  };
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
