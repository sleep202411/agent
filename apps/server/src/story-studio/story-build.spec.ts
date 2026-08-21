import {
  compileStoryBuild,
  type StoryBuildCompilerInput,
  type StoryBuildVideoInput,
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

function video(graphNodeId: string): StoryBuildVideoInput {
  return {
    graphNodeId,
    selectionVersion: 1,
    asset: {
      assetId: `asset-${graphNodeId}`,
      variantId: `variant-${graphNodeId}`,
      checksumSha256: 'a'.repeat(64),
      contentType: 'video/mp4',
      sizeBytes: 1_024n,
      width: 1920,
      height: 1080,
      durationMs: 5_000,
      browserSafeMp4: true,
      url: `https://cdn.example/${graphNodeId}.mp4`,
    },
    eligibilityDiagnostics: [],
  };
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
    videos: content.graph.nodes.map((node) => video(node.nodeId)),
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

  it('blocks production when a clip has no frozen video', () => {
    const result = compileStoryBuild(
      input({ videos: [video('opening'), video('left')] }),
    );
    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_CURRENT_VIDEO_REQUIRED',
          severity: 'error',
          entityId: 'right',
        }),
      ]),
    );
  });

  it('keeps a working preview playable while footage is incomplete', () => {
    const result = compileStoryBuild(
      input({ channel: 'preview', videos: [video('opening'), video('left')] }),
    );
    expect(result.runtime).not.toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_CURRENT_VIDEO_REQUIRED',
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
        videos: [video(opening.nodeId), video(left.nodeId)],
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
        videos: [video(opening.nodeId), video(left.nodeId)],
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
        videos: [video('opening'), video('left')],
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
              }),
            }),
          ]),
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
        videos: [video('opening')],
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
