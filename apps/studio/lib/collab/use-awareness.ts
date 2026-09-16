"use client";

import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

export interface PeerUser {
  id?: string;
  name?: string;
  color?: string;
  avatarUrl?: string;
}

export interface PeerPresence {
  clientId: number;
  user?: PeerUser;
  cursor?: { x: number; y: number } | null;
}

/**
 * Subscribes to a Y awareness instance and returns the REMOTE peers' presence
 * (identity + cursor), excluding this client. Drives the live cursors + the
 * active-user avatar group.
 */
export function useAwarenessPeers(
  awareness: Awareness | null,
  localClientId: number | undefined
): PeerPresence[] {
  const [snapshot, setSnapshot] = useState<{
    awareness: Awareness | null;
    localClientId: number | undefined;
    peers: PeerPresence[];
  } | null>(null);

  useEffect(() => {
    if (!awareness) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setSnapshot(null);
      return;
    }
    const update = () => {
      const next: PeerPresence[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === localClientId) return;
        const presence = state as { user?: unknown; cursor?: unknown };
        let user: PeerUser | undefined;
        if (presence.user && typeof presence.user === "object" && !Array.isArray(presence.user)) {
          const raw = presence.user as Record<string, unknown>;
          user = {};
          for (const field of ["id", "name", "color", "avatarUrl"] as const) {
            if (typeof raw[field] === "string") user[field] = raw[field];
          }
        }
        let cursor: PeerPresence["cursor"] = null;
        if (
          presence.cursor &&
          typeof presence.cursor === "object" &&
          !Array.isArray(presence.cursor)
        ) {
          const raw = presence.cursor as Record<string, unknown>;
          if (
            typeof raw.x === "number" &&
            Number.isFinite(raw.x) &&
            typeof raw.y === "number" &&
            Number.isFinite(raw.y)
          ) {
            cursor = { x: raw.x, y: raw.y };
          }
        }
        next.push({ clientId, user, cursor });
      });
      setSnapshot({ awareness, localClientId, peers: next });
    };
    update();
    awareness.on("change", update);
    return () => awareness.off("change", update);
  }, [awareness, localClientId]);

  return snapshot?.awareness === awareness && snapshot.localClientId === localClientId
    ? snapshot.peers
    : [];
}
