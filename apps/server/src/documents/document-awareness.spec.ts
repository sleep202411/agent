import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import { DocumentAwarenessRegistry } from './document-awareness';

describe('DocumentAwarenessRegistry', () => {
  let reg: DocumentAwarenessRegistry;
  const disposables: Array<() => void> = [];

  beforeEach(() => {
    reg = new DocumentAwarenessRegistry();
  });
  afterEach(() => {
    reg.destroyAll();
    for (const dispose of disposables.splice(0)) dispose();
  });

  /** A client-side awareness producing an encoded update for its own state. */
  function makeClient(state: Record<string, unknown>) {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(state);
    disposables.push(() => {
      awareness.destroy();
      doc.destroy();
    });
    return {
      clientId: doc.clientID,
      update: encodeAwarenessUpdate(awareness, [doc.clientID]),
    };
  }

  /** A bare peer awareness for asserting what a relayed update produces. */
  function makePeer(): Awareness {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    disposables.push(() => {
      awareness.destroy();
      doc.destroy();
    });
    return awareness;
  }

  it('holds no server-side state of its own', () => {
    reg.acquire('doc-1');
    expect(reg.size('doc-1')).toBe(0);
  });

  it('applies a client update and bootstraps a peer with it', () => {
    reg.acquire('doc-1');
    const client = makeClient({
      cursor: { x: 12, y: 34 },
      user: { name: 'A' },
    });
    reg.apply('doc-1', client.update, 'some-origin');
    expect(reg.size('doc-1')).toBe(1);

    const snapshot = reg.encodeStates('doc-1');
    expect(snapshot).not.toBeNull();

    const peer = makePeer();
    applyAwarenessUpdate(peer, snapshot as Uint8Array, 'remote');
    expect(peer.getStates().get(client.clientId)).toEqual({
      cursor: { x: 12, y: 34 },
      user: { name: 'A' },
    });
  });

  it('tracks controlled client-ids on the originating socket', () => {
    reg.acquire('doc-1');
    const socket = { __socketId: 's1', __controlledIds: new Set<number>() };
    const client = makeClient({ cursor: { x: 1, y: 1 } });
    reg.apply('doc-1', client.update, socket);
    expect([...socket.__controlledIds]).toEqual([client.clientId]);
  });

  it('removeClients clears the cursor and emits a removal a peer applies', () => {
    reg.acquire('doc-1');
    const socket = { __controlledIds: new Set<number>() };
    const client = makeClient({ cursor: { x: 7, y: 7 } });
    reg.apply('doc-1', client.update, socket);

    const peer = makePeer();
    applyAwarenessUpdate(peer, reg.encodeStates('doc-1') as Uint8Array, 'r');
    expect(peer.getStates().has(client.clientId)).toBe(true);

    const removal = reg.removeClients('doc-1', [...socket.__controlledIds]);
    expect(removal).not.toBeNull();
    expect(reg.size('doc-1')).toBe(0);

    applyAwarenessUpdate(peer, removal as Uint8Array, 'r');
    expect(peer.getStates().has(client.clientId)).toBe(false);
  });

  it('encodeStates is null and removeClients a no-op when empty', () => {
    reg.acquire('doc-1');
    expect(reg.encodeStates('doc-1')).toBeNull();
    expect(reg.removeClients('doc-1', [123])).toBeNull();
  });

  it('keeps the room alive until the last reference is released', () => {
    reg.acquire('doc-1');
    reg.acquire('doc-1');
    const client = makeClient({ cursor: { x: 1, y: 1 } });
    reg.apply('doc-1', client.update, 'o');
    expect(reg.size('doc-1')).toBe(1);

    reg.release('doc-1');
    expect(reg.size('doc-1')).toBe(1); // still one reference

    reg.release('doc-1');
    expect(reg.size('doc-1')).toBe(0); // room destroyed
    // applying after destroy is a safe no-op (no room)
    reg.apply('doc-1', client.update, 'o');
    expect(reg.size('doc-1')).toBe(0);
  });

  it('merges multiple clients into the bootstrap snapshot', () => {
    reg.acquire('doc-1');
    const a = makeClient({ user: { name: 'A' } });
    const b = makeClient({ user: { name: 'B' } });
    reg.apply('doc-1', a.update, 'o');
    reg.apply('doc-1', b.update, 'o');
    expect(reg.size('doc-1')).toBe(2);

    const peer = makePeer();
    applyAwarenessUpdate(peer, reg.encodeStates('doc-1') as Uint8Array, 'r');
    expect(peer.getStates().get(a.clientId)).toEqual({ user: { name: 'A' } });
    expect(peer.getStates().get(b.clientId)).toEqual({ user: { name: 'B' } });
  });
});
