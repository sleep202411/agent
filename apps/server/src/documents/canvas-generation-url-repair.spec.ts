import * as Y from 'yjs';
import { encodeDocumentSnapshot } from './document-crdt';
import { rootSchemaFor } from './document-modes';
import { repairCanvasGenerationUrls } from './canvas-generation-url-repair';

const oldUrl = 'https://account.r2.cloudflarestorage.com/bucket/video.mp4';
const repair = {
  nodeId: 'node',
  jobId: 'job',
  assetId: 'asset',
  url: 'https://r2.fizzdragon.com/video.mp4',
};
function fixture() {
  const encoded = encodeDocumentSnapshot(
    {
      nodes: {
        node: {
          id: 'node',
          type: 'video',
          position: { x: 12, y: 34 },
          data: {
            name: 'User title',
            prompt: 'User prompt',
            generation: {
              jobId: 'job',
              status: 'done',
              outputs: [
                {
                  assetId: 'asset',
                  url: oldUrl,
                  type: 'video',
                  durationSeconds: 30,
                },
              ],
            },
          },
        },
      },
      assets: {
        asset: {
          id: 'asset',
          mediaAssetId: 'asset',
          url: oldUrl,
          kind: 'video',
          createdAt: 123,
        },
      },
    },
    rootSchemaFor('canvas')!,
  );
  const doc = new Y.Doc();
  for (const root of ['meta', 'nodes', 'edges', 'groups', 'assets'])
    doc.getMap(root);
  Y.applyUpdate(doc, encoded.state);
  return doc;
}

it('changes only both URLs, converges by delta replay, and is idempotent', () => {
  const doc = fixture();
  const peer = fixture();
  try {
    // Use the same CRDT base, as two real peers do.
    peer.destroy();
    const clone = new Y.Doc();
    for (const root of ['meta', 'nodes', 'edges', 'groups', 'assets'])
      clone.getMap(root);
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
    const before = doc.toJSON();
    const vector = Y.encodeStateVector(doc);
    expect(repairCanvasGenerationUrls(doc, [repair])).toHaveLength(2);
    const expected = structuredClone(before) as {
      nodes: {
        node: { data: { generation: { outputs: Array<{ url: string }> } } };
      };
      assets: { asset: { url: string } };
    };
    expected.nodes.node.data.generation.outputs[0].url = repair.url;
    expected.assets.asset.url = repair.url;
    expect(doc.toJSON()).toEqual(expected);
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc, vector));
    expect(clone.toJSON()).toEqual(expected);
    expect(repairCanvasGenerationUrls(doc, [repair])).toEqual([]);
    clone.destroy();
  } finally {
    doc.destroy();
  }
});

it.each([
  { ...repair, jobId: 'newer-job' },
  { ...repair, assetId: 'other-asset' },
  { ...repair, url: oldUrl },
  { ...repair, url: `${repair.url}?sig=temporary` },
])(
  'rejects conflicting identities and non-durable URLs without mutations: %j',
  (invalid) => {
    const doc = fixture();
    try {
      const before = doc.toJSON();
      expect(() => repairCanvasGenerationUrls(doc, [invalid])).toThrow();
      expect(doc.toJSON()).toEqual(before);
    } finally {
      doc.destroy();
    }
  },
);

it('does not partially apply an invalid batch', () => {
  const doc = fixture();
  try {
    const before = doc.toJSON();
    expect(() =>
      repairCanvasGenerationUrls(doc, [
        repair,
        { ...repair, nodeId: 'missing' },
      ]),
    ).toThrow();
    expect(doc.toJSON()).toEqual(before);
  } finally {
    doc.destroy();
  }
});
