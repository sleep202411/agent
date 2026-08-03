import {
  compileStoryBuild,
  type StoryBuildCompilerInput,
  type StoryBuildVideoInput,
} from './story-build-compiler';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000001';
const BUILD_ID = '0197f4a2-0800-7000-8000-000000000002';

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
          exit: { kind: 'auto', nextNodeId: null },
        },
        {
          kind: 'clip',
          nodeId: 'right',
          clipKey: 'RIGHT',
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

  it('keeps disconnected canvas work out of the playable cut', () => {
    const content = draft();
    content.graph.nodes.push({
      kind: 'clip',
      nodeId: 'orphan',
      clipKey: 'ORPHAN',
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
});
