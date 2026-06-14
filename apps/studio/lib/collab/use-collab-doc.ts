"use client";

import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { DocumentProvider, type ConnectionStatus } from "./document-provider";
import type { RootSchema } from "./protocol";

export interface CollabUser {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
}

export interface CollabDocHandle {
  provider: DocumentProvider | null;
  doc: Y.Doc | null;
  awareness: Awareness | null;
  status: ConnectionStatus;
}

/**
 * React lifecycle wrapper around {@link DocumentProvider} for ANY collaborative
 * document mode. Creates the provider (with the mode's `rootSchema`) when a
 * documentId is known, tears it down on unmount / documentId change, and keeps
 * the local awareness identity in sync without recreating the connection. The
 * provider is schema-agnostic, so each mode supplies its own root schema.
 */
export function useCollabDoc(
  documentId: string | null | undefined,
  user: CollabUser | null,
  rootSchema: RootSchema
): CollabDocHandle {
  const [provider, setProvider] = useState<DocumentProvider | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    // The provider is a browser-only, side-effectful resource (WebSocket +
    // IndexedDB) tied to documentId, so it must be created in an effect and
    // surfaced via state for consumers to bind to — not memoized during render.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!documentId) {
      setProvider(null);
      return;
    }
    const next = new DocumentProvider({ documentId, rootSchema });
    setProvider(next);
    setStatus(next.getStatus());
    /* eslint-enable react-hooks/set-state-in-effect */
    const off = next.onStatus(setStatus);
    return () => {
      off();
      next.destroy();
    };
    // rootSchema is a stable module constant per mode; documentId drives the
    // lifecycle. (Re-creating on a new schema would also be correct, but a mode
    // never swaps its schema for a fixed documentId.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Set the identity once the provider exists and whenever it changes — covers
  // the initial user too (provider transitions null → instance here), so the
  // connection effect never depends on `user`.
  useEffect(() => {
    if (provider && user) provider.setAwarenessField("user", { ...user });
  }, [provider, user]);

  return {
    provider,
    doc: provider?.doc ?? null,
    awareness: provider?.awareness ?? null,
    // Never report a live status when there is no provider (e.g. documentId null
    // or torn down) — the status state can lag behind the provider lifecycle.
    status: provider ? status : "offline",
  };
}
