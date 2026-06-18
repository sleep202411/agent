import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';

/**
 * Per-document ephemeral awareness state (Figma-style live cursors + the active
 * user set behind the avatar group).
 *
 * Awareness is the transient presence channel of Yjs: each client continuously
 * broadcasts its cursor position and identity (name / color / avatar) as
 * volatile state that is fanned out to peers and **never persisted** to the
 * CRDT or Postgres. This registry holds one server-side `Awareness` instance per
 * active document on this pod so the gateway can:
 *   • bootstrap a freshly connected client with everyone's current state,
 *   • track which awareness client-ids a socket "controls" (to clear its cursor
 *     instantly on disconnect rather than waiting for the client-side timeout),
 *   • stay current with peers on OTHER pods (remote updates arrive via Redis).
 *
 * The server holds NO local awareness state of its own — it is a relay + cache.
 * Multi-pod correctness comes from fanning every update (including disconnect
 * removals) through Redis; awareness is last-write-wins per client-id by clock,
 * so applying the same stream on every pod converges.
 */
export interface AwarenessControlledOrigin {
  /** Awareness client-ids introduced over this connection. */
  __controlledIds?: Set<number>;
}

/** Origin marker for updates that arrived from another pod via Redis. */
export const REMOTE_ORIGIN = 'remote';

interface AwarenessRoom {
  doc: Y.Doc;
  awareness: Awareness;
  refs: number;
}

export class DocumentAwarenessRegistry {
  private readonly rooms = new Map<string, AwarenessRoom>();

  /** Ensure a room exists and increment its ref-count. Returns the Awareness. */
  acquire(documentId: string): Awareness {
    let room = this.rooms.get(documentId);
    if (!room) {
      const doc = new Y.Doc();
      const awareness = new Awareness(doc);
      // The server is a relay; it contributes no awareness state of its own.
      awareness.setLocalState(null);
      // Associate introduced/removed client-ids with the originating connection
      // so a disconnect can deterministically remove that socket's cursors.
      awareness.on(
        'update',
        (
          changes: { added: number[]; updated: number[]; removed: number[] },
          origin: unknown,
        ) => {
          const controlled = (origin as AwarenessControlledOrigin | null)
            ?.__controlledIds;
          if (!controlled) return;
          for (const id of changes.added) controlled.add(id);
          for (const id of changes.removed) controlled.delete(id);
        },
      );
      room = { doc, awareness, refs: 0 };
      this.rooms.set(documentId, room);
    }
    room.refs += 1;
    return room.awareness;
  }

  /** Decrement ref-count; destroy the room (and its timers) when it hits zero. */
  release(documentId: string): void {
    const room = this.rooms.get(documentId);
    if (!room) return;
    room.refs -= 1;
    if (room.refs <= 0) {
      room.awareness.destroy();
      room.doc.destroy();
      this.rooms.delete(documentId);
    }
  }

  /**
   * Apply an incoming awareness update. Pass the originating socket as `origin`
   * for a local client (enables controlled-id tracking) or {@link REMOTE_ORIGIN}
   * for an update relayed from another pod.
   */
  apply(documentId: string, update: Uint8Array, origin: unknown): void {
    const room = this.rooms.get(documentId);
    if (!room) return;
    applyAwarenessUpdate(room.awareness, update, origin);
  }

  /** Encode every current awareness state to bootstrap a new client, or null. */
  encodeStates(documentId: string): Uint8Array | null {
    const room = this.rooms.get(documentId);
    if (!room) return null;
    const clients = [...room.awareness.getStates().keys()];
    if (clients.length === 0) return null;
    return encodeAwarenessUpdate(room.awareness, clients);
  }

  /**
   * Remove the given client-ids (a disconnected socket's controlled ids) and
   * return the encoded removal update to fan out, or null if nothing changed.
   */
  removeClients(documentId: string, clientIds: number[]): Uint8Array | null {
    const room = this.rooms.get(documentId);
    if (!room || clientIds.length === 0) return null;
    const states = room.awareness.getStates();
    const present = clientIds.filter((id) => states.has(id));
    if (present.length === 0) return null;
    // origin is a string (not a controlled origin), so the bookkeeping listener
    // ignores it — we have already accounted for these ids on the socket.
    removeAwarenessStates(room.awareness, present, REMOTE_ORIGIN);
    return encodeAwarenessUpdate(room.awareness, present);
  }

  /** Number of active awareness client-ids for a document (tests / metrics). */
  size(documentId: string): number {
    return this.rooms.get(documentId)?.awareness.getStates().size ?? 0;
  }

  /** Destroy every room (graceful shutdown). */
  destroyAll(): void {
    for (const room of this.rooms.values()) {
      room.awareness.destroy();
      room.doc.destroy();
    }
    this.rooms.clear();
  }
}
