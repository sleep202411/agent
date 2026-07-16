import { migrateInteractiveFilmDraftV1ToV2 } from './interactive-film-draft-v2-migration';

const draft = (exit: unknown) => ({
  storyBible: {
    logline: '',
    synopsis: '',
    worldview: '',
    storyRules: [],
    characters: [],
    locations: [],
    props: [],
    stateVariables: [],
    endings: [],
  },
  graph: {
    entryNodeId: 'clip:a',
    nodes: [
      { kind: 'clip', nodeId: 'clip:a', clipKey: 'A', exit },
      {
        kind: 'clip',
        nodeId: 'clip:b',
        clipKey: 'B',
        exit: { kind: 'auto', routes: [] },
      },
      {
        kind: 'clip',
        nodeId: 'clip:c',
        clipKey: 'C',
        exit: { kind: 'auto', routes: [] },
      },
    ],
  },
  clipPrompts: [],
  trailerPrompt: null,
  productionNotes: [],
});

describe('migrateInteractiveFilmDraftV1ToV2', () => {
  it('collapses one unconditional clip route into a direct continuation', () => {
    const migrated = migrateInteractiveFilmDraftV1ToV2(
      draft({
        kind: 'auto',
        routes: [{ nextNodeId: 'clip:b', priority: 0 }],
      }),
    );

    expect(migrated.graph.nodes[0]).toMatchObject({
      kind: 'clip',
      exit: { kind: 'auto', nextNodeId: 'clip:b' },
    });
    expect(migrated.graph.nodes).toHaveLength(3);
  });

  it('preserves conditional branches by inserting a router', () => {
    const routes = [
      {
        nextNodeId: 'clip:b',
        priority: 1,
        when: { kind: 'flag', flag: 'lit', equals: true },
      },
      { nextNodeId: 'clip:c', priority: 2 },
    ];
    const migrated = migrateInteractiveFilmDraftV1ToV2(
      draft({ kind: 'auto', routes }),
    );
    const source = migrated.graph.nodes[0];
    expect(source.kind).toBe('clip');
    if (source.kind !== 'clip' || source.exit.kind !== 'auto') return;

    const router = migrated.graph.nodes.find(
      (node) => node.nodeId === source.exit.nextNodeId,
    );
    expect(router).toMatchObject({
      kind: 'router',
      exit: { kind: 'auto', routes },
    });
  });

  it('maps an unfinished clip to a null continuation', () => {
    const migrated = migrateInteractiveFilmDraftV1ToV2(
      draft({ kind: 'auto', routes: [] }),
    );
    expect(migrated.graph.nodes[0]).toMatchObject({
      kind: 'clip',
      exit: { kind: 'auto', nextNodeId: null },
    });
  });
});
