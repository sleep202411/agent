import {
  compileStoryBuild,
  type StoryBuildCompilerInput,
  type StoryBuildNodeTimelineInput,
  type StoryBuildSegmentInput,
  type StoryBuildWorldInput,
} from './story-build-compiler';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000001';
const BUILD_ID = '0197f4a2-0800-7000-8000-000000000002';
const WORLD_ID = '0197f4a2-0800-7000-8000-000000000003';

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: 'A gate opens.',
      synopsis: 'A visitor chooses a route through the gate.',
      characters: [],
    },
    graph: {
      entryNodeId: 'opening',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'opening',
          clipKey: 'OPENING',
          interactions: [],
          exit: {
            kind: 'choice',
            decisionId: 'route',
            prompt: { 'en-US': 'Which route?' },
            choices: [
              {
                choiceId: 'left',
                label: { 'en-US': 'Left' },
                nextNodeId: 'left',
              },
              {
                choiceId: 'right',
                label: { 'en-US': 'Right' },
                nextNodeId: 'right',
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'left',
          clipKey: 'LEFT',
          interactions: [],
          exit: { kind: 'auto', nextNodeId: null },
        },
        {
          kind: 'clip',
          nodeId: 'right',
          clipKey: 'RIGHT',
          interactions: [],
          exit: { kind: 'auto', nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  };
}

function videoSegment(
  graphNodeId: string,
  suffix = 'a',
): StoryBuildSegmentInput {
  return {
    clipId: `clip-${graphNodeId}-${suffix}`,
    clipKey: `shot.${graphNodeId}.${suffix}`,
    kind: 'video',
    durationMs: 5_000,
    clipVersion: 1,
    asset: {
      assetId: `asset-${graphNodeId}-${suffix}`,
      variantId: `variant-${graphNodeId}-${suffix}`,
      checksumSha256: 'a'.repeat(64),
      contentType: 'video/mp4',
      sizeBytes: 1_024n,
      width: 1920,
      height: 1080,
      durationMs: 5_000,
      browserSafeMp4: true,
      url: `https://cdn.example/${graphNodeId}-${suffix}.mp4`,
    },
    eligibilityDiagnostics: [],
  };
}

function stillSegment(
  graphNodeId: string,
  suffix = 'still',
): StoryBuildSegmentInput {
  return {
    clipId: `clip-${graphNodeId}-${suffix}`,
    clipKey: `shot.${graphNodeId}.${suffix}`,
    kind: 'image',
    durationMs: 4_000,
    clipVersion: 1,
    asset: {
      assetId: `asset-${graphNodeId}-${suffix}`,
      variantId: `variant-${graphNodeId}-${suffix}`,
      checksumSha256: 'b'.repeat(64),
      contentType: 'image/png',
      sizeBytes: 512n,
      width: 1920,
      height: 1080,
      durationMs: null,
      browserSafeMp4: null,
      url: `https://cdn.example/${graphNodeId}-${suffix}.png`,
    },
    eligibilityDiagnostics: [],
  };
}

function timeline(
  graphNodeId: string,
  segments: StoryBuildSegmentInput[] = [videoSegment(graphNodeId)],
): StoryBuildNodeTimelineInput {
  return { graphNodeId, sequenceId: `sequence-${graphNodeId}`, segments };
}

function input(
  overrides: Partial<StoryBuildCompilerInput> = {},
): StoryBuildCompilerInput {
  const content = overrides.draft ?? draft();
  return {
    projectId: PROJECT_ID,
    buildId: BUILD_ID,
    sourceDraftRevision: 1,
    channel: 'production',
    scope: { kind: 'full' },
    frameProfile: 'landscape_16_9',
    defaultLocale: 'en-US',
    metadata: { title: 'Gate', summary: null },
    draft: content,
    timelines: content.graph.nodes.map((node) => timeline(node.nodeId)),
    ...overrides,
  };
}

describe('compileStoryBuild', () => {
  it('compiles a complete branching film into the cinematic runtime', () => {
    const result = compileStoryBuild(input());
    expect(
      result.diagnostics.filter((item) => item.severity === 'error'),
    ).toEqual([]);
    expect(result.runtime).not.toBeNull();
    expect(result.pathReport).toMatchObject({
      enumeratedPathCount: 2,
      reachableTerminalNodeIds: ['left', 'right'],
      durationMinMs: 10_000,
      durationMaxMs: 10_000,
    });
    expect(result.runtime?.metadata.experienceProfile).toBe('cinematic');
  });

  // Unfilled work is reported, never refused: a creator may ship a work in
  // progress on purpose, and the scene still plays as an empty sequence so the
  // scenes pointing at it keep their exits.
  it('reports, but still releases, a scene with no storyboard sequence', () => {
    const result = compileStoryBuild(
      input({ timelines: [timeline('opening'), timeline('left')] }),
    );
    expect(result.runtime).not.toBeNull();
    expect(
      result.diagnostics.filter((item) => item.severity === 'error'),
    ).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_SEQUENCE_REQUIRED',
          severity: 'warning',
          entityId: 'right',
        }),
      ]),
    );
    const kept = result.runtime?.graph.nodes.some(
      (node) => 'sceneId' in node && node.sceneId === 'right',
    );
    expect(kept).toBe(true);
  });

  it('reports, but still releases, a storyboard clip with no selected media', () => {
    const result = compileStoryBuild(
      input({
        timelines: [
          timeline('opening'),
          timeline('left'),
          timeline('right', [{ ...videoSegment('right'), asset: null }]),
        ],
      }),
    );
    expect(result.runtime).not.toBeNull();
    expect(
      result.diagnostics.filter((item) => item.severity === 'error'),
    ).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_CLIP_MEDIA_REQUIRED',
          severity: 'warning',
          entityId: 'right',
        }),
      ]),
    );
  });

  it('plays a still-image segment for its storyboard length', () => {
    const result = compileStoryBuild(
      input({
        timelines: [
          timeline('opening', [
            stillSegment('opening'),
            videoSegment('opening'),
          ]),
          timeline('left'),
          timeline('right'),
        ],
      }),
    );
    expect(
      result.diagnostics.filter((item) => item.severity === 'error'),
    ).toEqual([]);
    const openingNode = result.runtime?.graph.nodes.find(
      (node) => 'sceneId' in node && node.sceneId === 'opening',
    ) as { renderers?: Array<{ config: Record<string, unknown> }> } | undefined;
    const config = openingNode?.renderers?.[0]?.config as {
      sequence: Array<{ endBehavior: Record<string, unknown> }>;
    };
    expect(config.sequence).toHaveLength(2);
    expect(config.sequence[0]?.endBehavior).toEqual({
      behavior: 'hold-last-frame',
      durationMs: 4_000,
    });
    expect(config.sequence[1]?.endBehavior).toEqual({ behavior: 'advance' });
  });

  // The compatibility contract for hosts that predate stills: a host refuses a
  // capability it does not have, so declaring this only when a still is really
  // present is what keeps video-only experiences playable on old players.
  it('requires the still capability only when a sequence actually holds a still', () => {
    const withStill = compileStoryBuild(
      input({
        timelines: [
          timeline('opening', [stillSegment('opening')]),
          timeline('left'),
          timeline('right'),
        ],
      }),
    );
    expect(withStill.runtime?.compatibility.requiredCapabilities).toContain(
      'core.video.still',
    );

    const videoOnly = compileStoryBuild(
      input({
        timelines: [
          timeline('opening', [videoSegment('opening')]),
          timeline('left'),
          timeline('right'),
        ],
      }),
    );
    expect(videoOnly.runtime?.compatibility.requiredCapabilities).not.toContain(
      'core.video.still',
    );
  });

  it('keeps a working preview playable while footage is incomplete', () => {
    const result = compileStoryBuild(
      input({
        channel: 'preview',
        timelines: [timeline('opening'), timeline('left')],
      }),
    );
    expect(result.runtime).not.toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_SEQUENCE_REQUIRED',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('keeps intentional replay loops playable in Preview and releases', () => {
    const content = draft();
    const opening = content.graph.nodes[0];
    const left = content.graph.nodes[1];
    if (!opening || opening.kind !== 'clip' || !left || left.kind !== 'clip') {
      throw new Error('Loop fixture clips are missing.');
    }
    opening.exit = { kind: 'auto', nextNodeId: left.nodeId };
    left.exit = { kind: 'auto', nextNodeId: opening.nodeId };
    content.graph.nodes = [opening, left];

    const preview = compileStoryBuild(
      input({
        channel: 'preview',
        draft: content,
        timelines: [timeline(opening.nodeId), timeline(left.nodeId)],
      }),
    );
    expect(preview.runtime).not.toBeNull();
    expect(preview.runtime?.completionPolicy).toBe('open-ended');
    expect(preview.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_GRAPH_CYCLE',
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'STORY_BUILD_NO_REACHABLE_TERMINAL',
          severity: 'warning',
        }),
      ]),
    );

    const production = compileStoryBuild(
      input({
        draft: content,
        timelines: [timeline(opening.nodeId), timeline(left.nodeId)],
      }),
    );
    expect(production.runtime).not.toBeNull();
    expect(production.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_GRAPH_CYCLE',
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'STORY_BUILD_NO_REACHABLE_TERMINAL',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('keeps disconnected canvas work out of the playable cut', () => {
    const content = draft();
    content.graph.nodes.push({
      kind: 'clip',
      nodeId: 'orphan',
      clipKey: 'ORPHAN',
      interactions: [],
      exit: { kind: 'auto', nextNodeId: 'orphan' },
    });
    const result = compileStoryBuild(input({ draft: content }));
    expect(result.runtime).not.toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_UNREACHABLE_NODE',
          severity: 'warning',
        }),
      ]),
    );
    expect(result.includedGraphNodeIds).not.toContain('orphan');
  });

  it('compiles a ready world node as a first-class runtime scene', () => {
    const content = draft();
    const opening = content.graph.nodes[0];
    if (!opening || opening.kind !== 'clip')
      throw new Error('Opening clip fixture is missing.');
    opening.exit = { kind: 'auto', nextNodeId: 'world' };
    content.graph.nodes = [
      opening,
      {
        kind: 'world',
        nodeId: 'world',
        worldId: WORLD_ID,
        name: 'Rain world',
        entryInstruction: 'Continue through the gate.',
        maxExperienceSeconds: 90,
        exit: { kind: 'auto', nextNodeId: 'left' },
      },
      content.graph.nodes[1],
    ];
    const worlds: StoryBuildWorldInput[] = [
      { graphNodeId: 'world', worldId: WORLD_ID, status: 'ready' },
    ];

    const result = compileStoryBuild(
      input({
        draft: content,
        timelines: [timeline('opening'), timeline('left')],
        worlds,
      }),
    );

    expect(
      result.diagnostics.filter((item) => item.severity === 'error'),
    ).toEqual([]);
    expect(result.pathReport.durationMinMs).toBe(100_000);
    expect(result.runtime?.rendererRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rendererId: 'core.world-model' }),
      ]),
    );
    expect(result.runtime?.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'scene',
          renderers: expect.arrayContaining([
            expect.objectContaining({
              rendererId: 'core.world-model',
              config: expect.objectContaining({
                projectId: PROJECT_ID,
                worldId: WORLD_ID,
                maxExperienceSeconds: 90,
              }) as unknown,
            }),
          ]) as unknown,
        }),
      ]),
    );
  });

  it('blocks playtest when a referenced world is not ready', () => {
    const content = draft();
    const opening = content.graph.nodes[0];
    if (!opening || opening.kind !== 'clip')
      throw new Error('Opening clip fixture is missing.');
    opening.exit = { kind: 'auto', nextNodeId: 'world' };
    content.graph.nodes = [
      opening,
      {
        kind: 'world',
        nodeId: 'world',
        worldId: WORLD_ID,
        maxExperienceSeconds: 60,
        exit: { kind: 'auto', nextNodeId: null },
      },
    ];

    const result = compileStoryBuild(
      input({
        channel: 'preview',
        draft: content,
        timelines: [timeline('opening')],
        worlds: [
          { graphNodeId: 'world', worldId: WORLD_ID, status: 'generating' },
        ],
      }),
    );

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_WORLD_NOT_READY',
          severity: 'error',
          entityId: 'world',
        }),
      ]),
    );
  });
});
