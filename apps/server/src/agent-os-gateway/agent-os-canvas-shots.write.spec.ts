import * as Y from 'yjs';
import {
  AGENT_SHOT_ID_PREFIX,
  compareByOrder,
  type ShotWrite,
} from '@repo/shared';
import { AgentOsCanvasShotsService } from './agent-os-canvas-shots.service';
import { readShotRows } from './agent-os-canvas-shots.service';

/**
 * The shot write, exercised against a real Y.Doc.
 *
 * `writeShotNodes` is private because callers must go through the one hydrate
 * that also appends the operation — reaching in here is deliberate: these are
 * the rules that used to live in a second store, and they are what the
 * convergence had to preserve.
 */
type WriteShotNodes = (
  doc: Y.Doc,
  shots: ShotWrite[],
) => Array<{ id: string; title: string; nodeId: string }>;

const write = (
  AgentOsCanvasShotsService.prototype as unknown as {
    writeShotNodes: WriteShotNodes;
  }
).writeShotNodes.bind({} as AgentOsCanvasShotsService);

function newDoc(): Y.Doc {
  const doc = new Y.Doc({ gc: true });
  doc.getMap('nodes');
  doc.getMap('edges');
  return doc;
}

/** A row the user created in the storyboard table: raw UUID, no agent stamp. */
function seedHumanShot(doc: Y.Doc, id: string, data: Record<string, unknown>) {
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  const node = new Y.Map<unknown>();
  nodes.set(id, node);
  node.set('id', id);
  node.set('type', 'shot');
  const position = new Y.Map<number>();
  position.set('x', 0);
  position.set('y', 0);
  node.set('position', position);
  const shotData = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(data)) shotData.set(key, value);
  node.set('data', shotData);
}

function rows(doc: Y.Doc) {
  return readShotRows(doc.toJSON() as Record<string, unknown>);
}

const create = (id: string, extra: Partial<ShotWrite> = {}): ShotWrite => ({
  id,
  intent: 'create',
  title: id,
  ...extra,
});

describe('shot writes', () => {
  it('creates shots in board order with keys the client accepts', () => {
    const doc = newDoc();
    write(doc, [create('s1'), create('s2'), create('s3')]);

    const board = rows(doc);
    expect(board.map((row) => row.id)).toEqual(['s1', 's2', 's3']);
    // The a0 regression: every minted key must survive the shared sort.
    expect([...board].sort(compareByOrder).map((row) => row.id)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  it('edits a shot the user authored, addressed by its raw node id', () => {
    const doc = newDoc();
    const humanId = '7f3a1c88-0000-4000-8000-000000000001';
    seedHumanShot(doc, humanId, {
      order: 'V',
      label: 'Rooftop',
      description: 'cold blue key light',
    });

    write(doc, [{ id: humanId, intent: 'replace', shotSize: 'closeUp' }]);

    const [row] = rows(doc);
    expect(row.id).toBe(humanId);
    expect(row.shotSize).toBe('closeUp');
    // Untouched fields survive — the write patches, it does not overwrite.
    expect(row.title).toBe('Rooftop');
    expect(row.description).toBe('cold blue key light');
    expect(row.agentAuthored).toBe(false);
  });

  it('never writes the image prompt into the human description column', () => {
    const doc = newDoc();
    seedHumanShot(doc, 'human-1', {
      order: 'V',
      description: '人写的画面描述',
    });

    write(doc, [
      { id: 'human-1', intent: 'replace', prompt: 'wide rooftop at dusk' },
    ]);

    const [row] = rows(doc);
    expect(row.prompt).toBe('wide rooftop at dusk');
    expect(row.description).toBe('人写的画面描述');
  });

  it('refuses to create over an existing id and to replace a missing one', () => {
    const doc = newDoc();
    write(doc, [create('s1')]);

    expect(() => write(doc, [create('s1')])).toThrow(
      /SHOT_EXISTS|already exists/,
    );
    expect(() =>
      write(doc, [{ id: 'nope', intent: 'replace', title: 'x' }]),
    ).toThrow(/SHOT_NOT_FOUND|Unknown shot/);
  });

  it('places a new shot after a named row, including a human one', () => {
    const doc = newDoc();
    seedHumanShot(doc, 'human-1', { order: 'V', label: 'First' });
    write(doc, [create('s2'), create('s3')]);

    write(doc, [create('inserted', { after: 'human-1' })]);

    expect(rows(doc).map((row) => row.id)).toEqual([
      'human-1',
      'inserted',
      's2',
      's3',
    ]);
  });

  it('places at the top of the board when after is null', () => {
    const doc = newDoc();
    write(doc, [create('s1'), create('s2')]);

    write(doc, [create('opening', { after: null })]);

    expect(rows(doc).map((row) => row.id)).toEqual(['opening', 's1', 's2']);
  });

  it('reorders an existing shot without touching its content', () => {
    const doc = newDoc();
    write(doc, [create('s1'), create('s2'), create('s3')]);

    write(doc, [{ id: 's3', intent: 'replace', after: null }]);

    const board = rows(doc);
    expect(board.map((row) => row.id)).toEqual(['s3', 's1', 's2']);
    expect(board[0].title).toBe('s3');
  });

  it('leaves an existing row where it is when after is omitted', () => {
    const doc = newDoc();
    write(doc, [create('s1'), create('s2')]);

    write(doc, [{ id: 's1', intent: 'replace', notes: 'touched' }]);

    expect(rows(doc).map((row) => row.id)).toEqual(['s1', 's2']);
  });

  it('stamps provenance on its own rows and never on a human row', () => {
    const doc = newDoc();
    seedHumanShot(doc, 'human-1', { order: 'V' });
    write(doc, [
      create('s1'),
      { id: 'human-1', intent: 'replace', notes: 'x' },
    ]);

    const byId = new Map(rows(doc).map((row) => [row.id, row]));
    expect(byId.get('s1')?.nodeId).toBe(`${AGENT_SHOT_ID_PREFIX}s1`);
    expect(byId.get('s1')?.agentAuthored).toBe(true);
    expect(byId.get('human-1')?.agentAuthored).toBe(false);
  });

  it('keeps the first shot clear of work already on the canvas', () => {
    const doc = newDoc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const card = new Y.Map<unknown>();
    nodes.set('gen-1', card);
    card.set('id', 'gen-1');
    card.set('type', 'generation');
    const position = new Y.Map<number>();
    position.set('x', 100);
    position.set('y', 80);
    card.set('position', position);

    write(doc, [create('s1')]);

    const content = doc.toJSON() as {
      nodes: Record<string, { position: { x: number; y: number } }>;
    };
    const placed = content.nodes[`${AGENT_SHOT_ID_PREFIX}s1`].position;
    expect(placed).not.toEqual({ x: 0, y: 0 });
    expect(placed.y).toBeGreaterThan(80);
  });
});
