import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { projectSavedStoryboard } from './saved-storyboard';
import {
  DocumentStateBuilder,
  encodeDocumentSnapshot,
} from '../documents/document-crdt';
import { rootSchemaFor } from '../documents/document-modes';
const asset = randomUUID();
const source = {
  id: 'video',
  type: 'videoAsset',
  data: { src: 'https://media.invalid/clip.mp4', mediaAssetId: asset },
};
const shot = (id: string, order: string) => ({
  id,
  type: 'shot',
  data: { order },
});
const edge = (id: string, target: string) => ({ id, source: 'video', target });
const snapshot = () => ({
  nodes: {
    video: structuredClone(source),
    second: shot('second', 'a2'),
    first: shot('first', 'a1'),
  },
  edges: { e2: edge('e2', 'second'), e1: edge('e1', 'first') },
});
it('uses saved fractional order, repeats shared clips, and does not export canvas placement', () => {
  const result = projectSavedStoryboard(snapshot());
  expect(result.map((c) => c.shotId)).toEqual(['first', 'second']);
  expect(result.map((c) => c.mediaAssetId)).toEqual([asset, asset]);
});
it('does not substitute the latest generated media ID for a selected older output', () => {
  const raw = snapshot();
  Object.assign(raw.nodes.first.data, {
    references: {
      clip: [{ edgeId: 'e1', url: 'https://media.invalid/older.mp4' }],
    },
  });
  expect(projectSavedStoryboard(raw)[0]).toMatchObject({
    sourceUrl: 'https://media.invalid/older.mp4',
    mediaAssetId: null,
  });
});
it('requires a video for every shot and rejects incomplete generation', () => {
  const raw = snapshot();
  delete (raw.edges as Partial<typeof raw.edges>).e1;
  expect(() => projectSavedStoryboard(raw)).toThrow('first has no ready video');
  const running = snapshot();
  Object.assign(running.nodes.video.data, {
    generation: { status: 'generating' },
  });
  expect(() => projectSavedStoryboard(running)).toThrow('no ready video');
});
it('rejects inconsistent identities and browser-only media', () => {
  const raw = snapshot();
  raw.nodes.video.id = 'forged';
  expect(() => projectSavedStoryboard(raw)).toThrow('identity');
  const blob = snapshot();
  blob.nodes.video = { ...source, data: { ...source.data, src: 'blob:local' } };
  expect(() => projectSavedStoryboard(blob)).toThrow('not saved');
});
it('detects unresolved Yjs dependencies and becomes exportable after they arrive', () => {
  const base = encodeDocumentSnapshot(snapshot(), rootSchemaFor('canvas')!);
  const client = new Y.Doc();
  Y.applyUpdate(client, base.state);
  const updates: Uint8Array[] = [];
  client.on('update', (update: Uint8Array) => updates.push(update));
  const nodes = client.getMap<Y.Map<unknown>>('nodes');
  const data = nodes.get('first')!.get('data') as Y.Map<unknown>;
  data.set('order', 'a3');
  data.set('order', 'a4');
  const builder = new DocumentStateBuilder(base.state, rootSchemaFor('canvas'));
  try {
    builder.apply(updates[1]);
    expect(builder.hasUnresolvedUpdates()).toBe(true);
    builder.apply(updates[0]);
    expect(builder.hasUnresolvedUpdates()).toBe(false);
    expect(
      projectSavedStoryboard(builder.snapshot()).map((c) => c.shotId),
    ).toEqual(['second', 'first']);
  } finally {
    builder.destroy();
    client.destroy();
  }
});

it('detects a pending deletion until its referenced content arrives', () => {
  const client = new Y.Doc();
  const updates: Uint8Array[] = [];
  client.on('update', (u: Uint8Array) => updates.push(u));
  client.getMap('nodes').set('late', { id: 'late', type: 'shot', data: {} });
  client.getMap('nodes').delete('late');
  const builder = new DocumentStateBuilder(null, rootSchemaFor('canvas'));
  try {
    builder.apply(updates[1]);
    expect(builder.hasUnresolvedUpdates()).toBe(true);
    builder.apply(updates[0]);
    expect(builder.hasUnresolvedUpdates()).toBe(false);
  } finally {
    builder.destroy();
    client.destroy();
  }
});
