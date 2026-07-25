import {
  EMPTY_STORY_PRODUCTION_CANVAS_CONTENT,
  StoryProductionCanvasContentSchema,
} from './story-production-canvas.schema';

describe('StoryProductionCanvasContentSchema', () => {
  it('accepts the empty project-owned production canvas', () => {
    expect(
      StoryProductionCanvasContentSchema.parse(
        EMPTY_STORY_PRODUCTION_CANVAS_CONTENT,
      ),
    ).toEqual({ nodes: [], edges: [], assets: [], groups: [] });
  });

  it('accepts a typed graph with a reusable uploaded asset', () => {
    const content = {
      nodes: [
        {
          id: 'source',
          type: 'image',
          position: { x: 100, y: 200 },
          data: { src: 'https://media.example/source.png' },
        },
        {
          id: 'generator',
          type: 'video',
          position: { x: 500, y: 200 },
          data: { prompt: 'A continuous camera move' },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'source',
          target: 'generator',
          sourceHandle: 'output',
          targetHandle: 'input',
        },
      ],
      assets: [
        {
          id: 'asset-1',
          kind: 'image',
          source: 'uploaded',
          url: 'https://media.example/source.png',
          createdAt: 1_700_000_000_000,
        },
      ],
      groups: [
        {
          id: 'opening',
          nodeIds: ['source', 'generator'],
          color: 'blue',
        },
      ],
    };

    expect(StoryProductionCanvasContentSchema.parse(content)).toEqual(content);
  });

  it('defaults legacy groups to the neutral slate background', () => {
    const content = StoryProductionCanvasContentSchema.parse({
      nodes: [
        {
          id: 'node-1',
          type: 'note',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'node-2',
          type: 'note',
          position: { x: 320, y: 0 },
          data: {},
        },
      ],
      edges: [],
      assets: [],
      groups: [{ id: 'legacy', nodeIds: ['node-1', 'node-2'] }],
    });

    expect(content.groups).toEqual([
      {
        id: 'legacy',
        nodeIds: ['node-1', 'node-2'],
        color: 'slate',
      },
    ]);
  });

  it('rejects edges that reference nodes outside the document', () => {
    const parsed = StoryProductionCanvasContentSchema.safeParse({
      nodes: [],
      edges: [{ id: 'edge-1', source: 'missing', target: 'also-missing' }],
      assets: [],
      groups: [],
    });

    expect(parsed.success).toBe(false);
  });

  it.each([
    {
      field: 'nodes',
      content: {
        nodes: [
          { id: 'duplicate', type: 'note', position: { x: 0, y: 0 }, data: {} },
          { id: 'duplicate', type: 'note', position: { x: 1, y: 1 }, data: {} },
        ],
        edges: [],
        assets: [],
        groups: [],
      },
    },
    {
      field: 'assets',
      content: {
        nodes: [],
        edges: [],
        assets: [
          {
            id: 'duplicate',
            kind: 'image',
            source: 'uploaded',
            url: 'https://media.example/a.png',
            createdAt: 1,
          },
          {
            id: 'duplicate',
            kind: 'image',
            source: 'uploaded',
            url: 'https://media.example/b.png',
            createdAt: 2,
          },
        ],
        groups: [],
      },
    },
  ])('rejects duplicate $field ids', ({ content }) => {
    expect(StoryProductionCanvasContentSchema.safeParse(content).success).toBe(
      false,
    );
  });

  it('rejects missing, duplicate, and cross-group node memberships', () => {
    const content = {
      nodes: [
        {
          id: 'node-1',
          type: 'note',
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
      edges: [],
      assets: [],
      groups: [
        { id: 'opening', nodeIds: ['node-1', 'node-1'] },
        { id: 'ending', nodeIds: ['node-1', 'missing'] },
      ],
    };

    expect(StoryProductionCanvasContentSchema.safeParse(content).success).toBe(
      false,
    );
  });

  it('rejects single-node group placeholders', () => {
    expect(
      StoryProductionCanvasContentSchema.safeParse({
        nodes: [
          {
            id: 'node-1',
            type: 'note',
            position: { x: 0, y: 0 },
            data: {},
          },
        ],
        edges: [],
        assets: [],
        groups: [{ id: 'group-1', nodeIds: ['node-1'] }],
      }).success,
    ).toBe(false);
  });
});
