import {
  PutStoryCanvasLayoutSchema,
  STORY_CANVAS_LAYOUT_NODE_COUNT_MAX,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
} from './dto';

describe('PutStoryCanvasLayoutSchema', () => {
  it('accepts product and synthetic canvas node identifiers', () => {
    const parsed = PutStoryCanvasLayoutSchema.parse({
      expectedRevision: 3,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: {
        'clip:scene-1': { x: 0, y: 120.25 },
        '__decision__:clip:scene-1': { x: 360, y: 60 },
      },
      sessionId: 'canvas-session',
    });

    expect(Object.keys(parsed.nodePositions)).toEqual([
      'clip:scene-1',
      '__decision__:clip:scene-1',
    ]);
  });

  it('rejects an unknown layout schema version', () => {
    const parsed = PutStoryCanvasLayoutSchema.safeParse({
      expectedRevision: 0,
      schemaVersion: 'story-canvas-layout-v2',
      nodePositions: {},
      sessionId: 'canvas-session',
    });

    expect(parsed.success).toBe(false);
  });

  it.each([
    ['unsafe node id', { 'node id': { x: 0, y: 0 } }],
    ['non-finite coordinate', { node: { x: Number.POSITIVE_INFINITY, y: 0 } }],
    ['out-of-range coordinate', { node: { x: 1_000_001, y: 0 } }],
  ])('rejects %s', (_label, nodePositions) => {
    const parsed = PutStoryCanvasLayoutSchema.safeParse({
      expectedRevision: 0,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions,
      sessionId: 'canvas-session',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects layouts above the node-count ceiling', () => {
    const nodePositions = Object.fromEntries(
      Array.from(
        { length: STORY_CANVAS_LAYOUT_NODE_COUNT_MAX + 1 },
        (_, index) => [`node:${index}`, { x: index, y: 0 }],
      ),
    );

    const parsed = PutStoryCanvasLayoutSchema.safeParse({
      expectedRevision: 0,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions,
      sessionId: 'canvas-session',
    });

    expect(parsed.success).toBe(false);
  });
});
