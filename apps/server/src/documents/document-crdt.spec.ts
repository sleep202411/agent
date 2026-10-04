import * as Y from 'yjs';
import {
  DocumentStateBuilder,
  encodeDocumentSnapshot,
  materializeSnapshot,
  mergeDocumentState,
} from './document-crdt';

/**
 * Run a list of mutations, each in its own Yjs transaction, and capture the
 * incremental binary update each one emits — exactly the op stream a client
 * would send and the server would persist to the op log.
 */
function captureUpdates(mutations: Array<(doc: Y.Doc) => void>): Uint8Array[] {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  for (const mutate of mutations) {
    Y.transact(doc, () => mutate(doc));
  }
  doc.destroy();
  return updates;
}

/** A representative canvas-style edit stream (nested maps, an in-place edit). */
function canvasMutations(): Array<(doc: Y.Doc) => void> {
  return [
    (doc) => {
      doc.getMap('meta').set('title', 'My canvas');
      doc.getMap('meta').set('mode', 'canvas');
    },
    (doc) => {
      const node = new Y.Map<unknown>();
      node.set('id', 'n1');
      node.set('type', 'image');
      const position = new Y.Map<number>();
      position.set('x', 10);
      position.set('y', 20);
      node.set('position', position);
      doc.getMap('nodes').set('n1', node);
    },
    (doc) => {
      const node = doc.getMap('nodes').get('n1') as Y.Map<unknown>;
      (node.get('position') as Y.Map<number>).set('x', 99);
    },
    (doc) => {
      const edge = new Y.Map<string>();
      edge.set('id', 'e1');
      edge.set('source', 'n1');
      edge.set('target', 'n2');
      doc.getMap('edges').set('e1', edge);
    },
  ];
}

const EXPECTED_SNAPSHOT = {
  meta: { title: 'My canvas', mode: 'canvas' },
  nodes: { n1: { id: 'n1', type: 'image', position: { x: 99, y: 20 } } },
  edges: { e1: { id: 'e1', source: 'n1', target: 'n2' } },
};

// The canvas mode's root-type schema (see document-modes.ts). Required for the
// server to materialize a JSON snapshot from binary CRDT state.
const SCHEMA = { meta: 'map', nodes: 'map', edges: 'map' } as const;
const FULL_CANVAS_SCHEMA = {
  meta: 'map',
  nodes: 'map',
  edges: 'map',
  groups: 'map',
  assets: 'map',
} as const;

describe('document-crdt', () => {
  it('converts the former Story array snapshot into canonical canvas maps', () => {
    const imported = encodeDocumentSnapshot(
      {
        nodes: [
          {
            id: 'image-1',
            type: 'image',
            position: { x: 12, y: 34 },
            data: { label: 'Reference', mediaAssetId: 'asset-1' },
            width: 320,
            height: 180,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            source: 'image-1',
            target: 'video-1',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
        ],
        groups: [{ id: 'group-1', nodeIds: ['image-1'], color: 'neutral' }],
        assets: [
          { id: 'asset-1', kind: 'image', url: 'https://example.test/a.jpg' },
        ],
      },
      FULL_CANVAS_SCHEMA,
    );

    expect(imported.snapshot).toEqual({
      meta: {},
      nodes: {
        'image-1': {
          id: 'image-1',
          type: 'image',
          position: { x: 12, y: 34 },
          data: { label: 'Reference', mediaAssetId: 'asset-1' },
          width: 320,
          height: 180,
        },
      },
      edges: {
        'edge-1': {
          id: 'edge-1',
          source: 'image-1',
          target: 'video-1',
          sourceHandle: 'output',
          targetHandle: 'input',
        },
      },
      groups: {
        'group-1': { id: 'group-1', nodeIds: ['image-1'], color: 'neutral' },
      },
      assets: {
        'asset-1': {
          id: 'asset-1',
          kind: 'image',
          url: 'https://example.test/a.jpg',
        },
      },
    });
    expect(
      mergeDocumentState(imported.state, [], FULL_CANVAS_SCHEMA).snapshot,
    ).toEqual(imported.snapshot);
  });

  it('preserves a canonical map snapshot when encoding imported state', () => {
    const source = {
      meta: { title: 'Shared workbench' },
      nodes: {
        n1: {
          id: 'n1',
          type: 'note',
          position: { x: 1, y: 2 },
          data: { prompt: 'Keep me' },
        },
      },
      edges: {},
      groups: {},
      assets: {},
    };
    expect(encodeDocumentSnapshot(source, FULL_CANVAS_SCHEMA).snapshot).toEqual(
      source,
    );
  });

  it('merges an op stream into the materialized snapshot', () => {
    const updates = captureUpdates(canvasMutations());
    const { snapshot } = mergeDocumentState(null, updates, SCHEMA);
    expect(snapshot).toEqual(EXPECTED_SNAPSHOT);
  });

  it('returns an empty snapshot and a replayable state for an empty document', () => {
    const { state, snapshot } = mergeDocumentState(null, []);
    expect(snapshot).toEqual({});
    // The encoded empty state must apply cleanly onto a fresh document.
    expect(mergeDocumentState(state, []).snapshot).toEqual({});
  });

  it('compaction is loss-free: base + tail ≡ replaying every update from scratch', () => {
    const updates = captureUpdates(canvasMutations());
    const fromScratch = mergeDocumentState(null, updates, SCHEMA).snapshot;

    // Compact at every possible split point and confirm the result is identical.
    for (let split = 0; split <= updates.length; split += 1) {
      const base = mergeDocumentState(
        null,
        updates.slice(0, split),
        SCHEMA,
      ).state;
      const tail = updates.slice(split);
      const compacted = mergeDocumentState(base, tail, SCHEMA);
      expect(compacted.snapshot).toEqual(fromScratch);
      // The re-encoded compacted state must itself be a valid, equivalent base.
      expect(mergeDocumentState(compacted.state, [], SCHEMA).snapshot).toEqual(
        fromScratch,
      );
    }
  });

  it('is idempotent under duplicate updates', () => {
    const updates = captureUpdates(canvasMutations());
    const fromScratch = mergeDocumentState(null, updates, SCHEMA).snapshot;
    const withDupes = mergeDocumentState(
      null,
      [...updates, ...updates],
      SCHEMA,
    ).snapshot;
    expect(withDupes).toEqual(fromScratch);
  });

  it('converges regardless of update order (commutativity)', () => {
    const updates = captureUpdates(canvasMutations());
    const fromScratch = mergeDocumentState(null, updates, SCHEMA).snapshot;
    const reversed = mergeDocumentState(
      null,
      [...updates].reverse(),
      SCHEMA,
    ).snapshot;
    expect(reversed).toEqual(fromScratch);
  });

  it('concurrent edits on independent keys both survive a merge', () => {
    const base = mergeDocumentState(
      null,
      captureUpdates(canvasMutations()),
      SCHEMA,
    ).state;

    // Two clients fork from the same base and edit different nodes concurrently.
    const docA = new Y.Doc();
    Y.applyUpdate(docA, base);
    const updateA: Uint8Array[] = [];
    docA.on('update', (u: Uint8Array) => updateA.push(u));
    Y.transact(docA, () => {
      const node = new Y.Map<string>();
      node.set('id', 'n2');
      node.set('type', 'note');
      docA.getMap('nodes').set('n2', node);
    });

    const docB = new Y.Doc();
    Y.applyUpdate(docB, base);
    const updateB: Uint8Array[] = [];
    docB.on('update', (u: Uint8Array) => updateB.push(u));
    Y.transact(docB, () => {
      docB.getMap('meta').set('title', 'Renamed');
    });
    docA.destroy();
    docB.destroy();

    const merged = mergeDocumentState(base, [...updateA, ...updateB], SCHEMA)
      .snapshot as {
      meta: { title: string };
      nodes: Record<string, unknown>;
    };
    expect(merged.meta.title).toBe('Renamed');
    expect(Object.keys(merged.nodes).sort()).toEqual(['n1', 'n2']);
  });

  it('DocumentStateBuilder folds batches equivalently to merging at once', () => {
    const updates = captureUpdates(canvasMutations());
    const oneShot = mergeDocumentState(null, updates, SCHEMA);

    const builder = new DocumentStateBuilder(null, SCHEMA);
    try {
      const mid = Math.floor(updates.length / 2);
      builder.applyAll(updates.slice(0, mid));
      builder.applyAll(updates.slice(mid));
      const batched = builder.finish();
      expect(batched.snapshot).toEqual(oneShot.snapshot);
      // Both encoded states must materialize to the same snapshot.
      expect(mergeDocumentState(batched.state, [], SCHEMA).snapshot).toEqual(
        oneShot.snapshot,
      );
    } finally {
      builder.destroy();
    }
  });

  it('keeps deletions collapsed across compaction (gc)', () => {
    const updates = captureUpdates([
      (doc) => {
        const node = new Y.Map<string>();
        node.set('id', 'n1');
        doc.getMap('nodes').set('n1', node);
      },
      (doc) => {
        doc.getMap('nodes').delete('n1');
      },
    ]);
    const empty = { meta: {}, nodes: {}, edges: {} };
    expect(mergeDocumentState(null, updates, SCHEMA).snapshot).toEqual(empty);
    // The compacted state must still reflect the deletion (no resurrection).
    const base = mergeDocumentState(null, updates, SCHEMA).state;
    expect(mergeDocumentState(base, [], SCHEMA).snapshot).toEqual(empty);
  });

  it('rejects use after destroy', () => {
    const builder = new DocumentStateBuilder(null);
    builder.destroy();
    expect(() => builder.finish()).toThrow(/after destroy/);
  });

  it('materializeSnapshot matches the merge snapshot', () => {
    const updates = captureUpdates(canvasMutations());
    expect(materializeSnapshot(null, updates, SCHEMA)).toEqual(
      mergeDocumentState(null, updates, SCHEMA).snapshot,
    );
  });
});

describe('retained collaborative content', () => {
  it('retains out-of-order values through compaction, then releases deleted values', () => {
    const mediaId = '11111111-1111-4111-8111-111111111111';
    const source = new Y.Doc();
    const node = new Y.Map<unknown>();
    source.getMap('nodes').set('image', node);
    const base = Y.encodeStateAsUpdate(source);
    const vector = Y.encodeStateVector(source);
    node.set('mediaAssetId', mediaId);
    const dependent = Y.encodeStateAsUpdate(source, vector);
    const pending = new DocumentStateBuilder(null, { nodes: 'map' });
    const restored = new DocumentStateBuilder(null, { nodes: 'map' });
    try {
      pending.apply(dependent);
      expect(JSON.stringify(pending.snapshot())).not.toContain(mediaId);
      expect(JSON.stringify(pending.retainedContent())).toContain(mediaId);
      restored.apply(pending.encodeState());
      expect(JSON.stringify(restored.retainedContent())).toContain(mediaId);
      restored.apply(base);
      expect(JSON.stringify(restored.snapshot())).toContain(mediaId);
      const beforeDelete = Y.encodeStateVector(source);
      node.delete('mediaAssetId');
      restored.apply(Y.encodeStateAsUpdate(source, beforeDelete));
      expect(JSON.stringify(restored.retainedContent())).not.toContain(mediaId);
    } finally {
      source.destroy();
      pending.destroy();
      restored.destroy();
    }
  });
});
