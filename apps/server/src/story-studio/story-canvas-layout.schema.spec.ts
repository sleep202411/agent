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
        '__ending__:truth': { x: 720, y: 120 },
      },
      sessionId: 'canvas-session',
    });

    expect(Object.keys(parsed.nodePositions)).toEqual([
      'clip:scene-1',
      '__decision__:clip:scene-1',
      '__ending__:truth',
    ]);
  });

  /**
   * The story-world card was removed from the canvas: the bible is project-level
   * and a chapter's entry is set on the scene. A client still sending a position
   * for the retired root is stale, and storing it would resurrect a node that no
   * longer has a renderer.
   */
  it('rejects a layout that still positions the retired story-world node', () => {
    const parsed = PutStoryCanvasLayoutSchema.safeParse({
      expectedRevision: 3,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: { __story_root__: { x: -640.5, y: 120 } },
      sessionId: 'canvas-session',
    });

    expect(parsed.success).toBe(false);
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
