import { readShotRows } from './agent-os-canvas-shots.service';

/**
 * The board read the agent sees. What matters here is not the field copying but
 * the two properties the old JSONB store could not have: human-authored shots
 * are visible and addressable, and the order is the SAME order the storyboard
 * table renders (both sides sort with @repo/shared's comparator).
 */
function shotNode(
  id: string,
  data: Record<string, unknown>,
): [string, Record<string, unknown>] {
  return [id, { id, type: 'shot', position: { x: 0, y: 0 }, data }];
}

function canvas(...nodes: Array<[string, Record<string, unknown>]>) {
  return { nodes: Object.fromEntries(nodes), edges: {}, meta: {}, groups: {} };
}

describe('readShotRows', () => {
  it('returns human-authored shots alongside agent ones, in board order', () => {
    const rows = readShotRows(
      canvas(
        shotNode('agent-os:shot:s2', {
          order: 'l',
          label: 'Agent second',
          agentOsShotId: 's2',
        }),
        // A shot the user created in the table: a raw UUID, no agentOsShotId.
        shotNode('7f3a1c88-0000-4000-8000-000000000001', {
          order: 'V',
          label: 'Human first',
        }),
      ),
    );

    expect(rows.map((row) => row.title)).toEqual([
      'Human first',
      'Agent second',
    ]);
    expect(rows.map((row) => row.agentAuthored)).toEqual([false, true]);
  });

  it('addresses agent shots by their shot id and human shots by their node id', () => {
    const rows = readShotRows(
      canvas(
        shotNode('agent-os:shot:s1', { order: 'V', agentOsShotId: 's1' }),
        shotNode('7f3a1c88-0000-4000-8000-000000000002', { order: 'l' }),
      ),
    );

    expect(rows.map((row) => row.id)).toEqual([
      's1',
      '7f3a1c88-0000-4000-8000-000000000002',
    ]);
    expect(rows.map((row) => row.nodeId)).toEqual([
      'agent-os:shot:s1',
      '7f3a1c88-0000-4000-8000-000000000002',
    ]);
  });

  it('ignores every node type that is not a shot', () => {
    const rows = readShotRows(
      canvas(
        shotNode('s', { order: 'V', label: 'Shot' }),
        [
          'note-1',
          { id: 'note-1', type: 'note', data: { label: 'Not a shot' } },
        ],
        ['gen-1', { id: 'gen-1', type: 'generation', data: { order: '0' } }],
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Shot');
  });

  it('parks an order-less shot last instead of dropping it', () => {
    const rows = readShotRows(
      canvas(
        shotNode('no-order', { label: 'Malformed' }),
        shotNode('ordered', { order: 'V', label: 'Ordered' }),
      ),
    );

    expect(rows.map((row) => row.title)).toEqual(['Ordered', 'Malformed']);
    expect(rows[1].order).toBeNull();
  });

  it('carries the craft columns a human filled in', () => {
    const [row] = readShotRows(
      canvas(
        shotNode('s', {
          order: 'V',
          label: 'Rooftop',
          imagePrompt: 'wide rooftop at dusk',
          description: 'cold blue key light, city bokeh behind',
          shotSize: 'wide',
          perspective: 'lowAngle',
          movement: 'dolly',
          dialogue: 'Nobody is coming.',
          videoPrompt: 'slow push in',
          durationSeconds: 4.5,
          notes: 'match cut to the alley',
        }),
      ),
    );

    expect(row).toMatchObject({
      title: 'Rooftop',
      prompt: 'wide rooftop at dusk',
      description: 'cold blue key light, city bokeh behind',
      shotSize: 'wide',
      perspective: 'lowAngle',
      movement: 'dolly',
      dialogue: 'Nobody is coming.',
      videoPrompt: 'slow push in',
      durationSeconds: 4.5,
      notes: 'match cut to the alley',
    });
  });

  it('survives a document with no nodes map at all', () => {
    expect(readShotRows({})).toEqual([]);
    expect(readShotRows({ nodes: null })).toEqual([]);
  });
});
