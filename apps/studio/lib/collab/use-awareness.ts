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
        const presence = state as { user?: PeerUser; cursor?: PeerPresence["cursor"] };
        next.push({ clientId, user: presence.user, cursor: presence.cursor ?? null });
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
