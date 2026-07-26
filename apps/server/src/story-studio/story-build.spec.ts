import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaStorageProvider,
  Prisma,
  StoryBuildKind,
  StoryBuildStatus,
  StoryRevisionSource,
} from '@prisma/client';
import { canonicalJsonHash } from './canonical-json';
import {
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
} from '@repo/shared/experience-runtime';
import {
  compileStoryBuild,
  type FrozenStoryVideoAsset,
  type StoryBuildCompilerInput,
  type StoryBuildVideoInput,
} from './story-build-compiler';
import {
  StoryBuildService,
  storyBuildRequestFingerprint,
} from './story-build.service';
import { LockableInteractiveStoryDraftContentSchema } from './interactive-film.schema';
import { CreateStoryBuildSchema } from './dto';
import {
  storyVideoSnapshotHash,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';

const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000003';
const BUILD_ID = '0197f4a2-0800-7000-8000-000000000004';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000005';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000006';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000007';
const CHECKSUM = 'a'.repeat(64);
const THEME_ASSET_ID = '0197f4a2-0800-7000-8000-000000000008';
const ECHO_ASSET_ID = '0197f4a2-0800-7000-8000-000000000009';

function simpleDraft() {
  return LockableInteractiveStoryDraftContentSchema.parse({
    storyBible: {
      logline: 'A single consequential moment.',
      synopsis: 'The protagonist reaches the truth.',
      worldview: 'Choices leave visible traces.',
      characters: [
        {
          id: 'hero',
          name: { 'en-US': 'Hero' },
          role: 'Protagonist',
          summary: 'The person who must face the truth.',
          playable: true,
          continuityRules: [],
        },
      ],
      endings: [
        {
          id: 'truth',
          title: { 'en-US': 'Truth' },
          summary: { 'en-US': 'The truth is accepted.' },
        },
      ],
    },
    graph: {
      entryNodeId: 'clip.start',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'clip.start',
          clipKey: 'START',
          exit: { kind: 'ending', endingId: 'truth' },
        },
      ],
    },
    productionNotes: [],
  });
}

function textDraft() {
  return LockableInteractiveStoryDraftContentSchema.parse({
    storyBible: {
      logline: '',
      synopsis: '',
      worldview: '',
      characters: [],
      endings: [
        {
          id: 'truth',
          title: { 'en-US': 'Truth' },
        },
      ],
    },
    graph: {
      entryNodeId: 'text.start',
      nodes: [
        {
          kind: 'text',
          nodeId: 'text.start',
          body: { 'en-US': 'At dawn, a sealed letter waits on the table.' },
          exit: { kind: 'ending', endingId: 'truth' },
        },
      ],
    },
    productionNotes: [],
  });
}

function mixedDraft() {
  const base = simpleDraft();
  return LockableInteractiveStoryDraftContentSchema.parse({
    ...base,
    graph: {
      entryNodeId: 'text.prologue',
      nodes: [
        {
          kind: 'text',
          nodeId: 'text.prologue',
          title: { 'en-US': 'Prologue' },
          body: { 'en-US': 'The story begins in words.' },
          exit: { kind: 'auto', nextNodeId: 'clip.start' },
        },
        ...base.graph.nodes,
      ],
    },
  });
}

function choiceDraft() {
  const base = simpleDraft();
  return LockableInteractiveStoryDraftContentSchema.parse({
    ...base,
    storyBible: {
      ...base.storyBible,
      endings: [
        {
          id: 'truth',
          title: { 'en-US': 'Truth' },
          summary: { 'en-US': 'The truth is accepted.' },
        },
        {
          id: 'echo',
          title: { 'en-US': 'Echo' },
          summary: { 'en-US': 'The moment echoes.' },
        },
      ],
    },
    graph: {
      entryNodeId: 'clip.start',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'clip.start',
          clipKey: 'START',
          exit: {
            kind: 'choice',
            decisionId: 'decision.path',
            prompt: { 'en-US': 'Which path?' },
            choices: [
              {
                choiceId: 'choose.truth',
                label: { 'en-US': 'Truth' },
                nextNodeId: 'clip.truth',
              },
              {
                choiceId: 'choose.echo',
                label: { 'en-US': 'Echo' },
                nextNodeId: 'clip.echo',
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'clip.truth',
          clipKey: 'TRUTH',
          exit: { kind: 'ending', endingId: 'truth' },
        },
        {
          kind: 'clip',
          nodeId: 'clip.echo',
          clipKey: 'ECHO',
          exit: { kind: 'ending', endingId: 'echo' },
        },
      ],
    },
  });
}

/**
 * `rounds` consecutive 3-way choices whose branches all reconverge on the next
 * hub — "wide but shallow", the shape a per-scene-choice story actually has.
 * Node count grows linearly (4 per round) while route count grows as 3^rounds.
 */
function wideChoiceDraft(rounds: number) {
  const base = simpleDraft();
  const nodes: unknown[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const hub = `clip.hub${round}`;
    const next = round + 1 === rounds ? 'clip.truth' : `clip.hub${round + 1}`;
    nodes.push({
      kind: 'clip',
      nodeId: hub,
      clipKey: `HUB${round}`,
      exit: {
        kind: 'choice',
        decisionId: `decision.round${round}`,
        prompt: { 'en-US': `Round ${round}?` },
        choices: ['a', 'b', 'c'].map((tag) => ({
          choiceId: `choose.${round}.${tag}`,
          label: { 'en-US': tag.toUpperCase() },
          nextNodeId: `clip.branch${round}${tag}`,
        })),
      },
    });
    ['a', 'b', 'c'].forEach((tag) => {
      nodes.push({
        kind: 'clip',
        nodeId: `clip.branch${round}${tag}`,
        clipKey: `BRANCH${round}${tag.toUpperCase()}`,
        exit: { kind: 'auto', nextNodeId: next },
      });
    });
  }
  nodes.push({
    kind: 'clip',
    nodeId: 'clip.truth',
    clipKey: 'TRUTH',
    exit: { kind: 'ending', endingId: 'truth' },
  });
  return LockableInteractiveStoryDraftContentSchema.parse({
    ...base,
    graph: { entryNodeId: 'clip.hub0', nodes },
  });
}

function frozenAsset(index: number, durationMs: number): FrozenStoryVideoAsset {
  return {
    assetId: `0197f4a2-1000-7000-8000-${index.toString().padStart(12, '0')}`,
    variantId: `0197f4a2-2000-7000-8000-${index.toString().padStart(12, '0')}`,
    checksumSha256: index.toString(16).padStart(64, '0'),
    contentType: 'video/mp4',
    sizeBytes: 1_000n,
    width: 1920,
    height: 1080,
    durationMs,
    browserSafeMp4: true,
    url: `/aurora/story-projects/${PROJECT_ID}/builds/${BUILD_ID}/assets/asset-${index}/variants/variant-${index}/content`,
  };
}

/** The ordinary public media URL a bound track resolves to. */
function musicUrl(mediaAssetId: string): string {
  return `https://media.example.com/workspace/audio/${mediaAssetId}.mp3`;
}

function compilerInput(
  draft = simpleDraft(),
  overrides: Partial<StoryBuildCompilerInput> = {},
): StoryBuildCompilerInput {
  const videos: StoryBuildVideoInput[] = draft.graph.nodes.flatMap(
    (node, index) =>
      node.kind === 'clip'
        ? [
            {
              graphNodeId: node.nodeId,
              selectionVersion: 1,
              asset: frozenAsset(index + 1, 5_000),
              eligibilityDiagnostics: [],
            },
          ]
        : [],
  );
  return {
    projectId: PROJECT_ID,
    format: 'interactive_film',
    buildId: BUILD_ID,
    sourceDraftRevision: 7,
    channel: 'production',
    scope: { kind: 'full' },
    frameProfile: 'landscape_16_9',
    defaultLocale: 'en-US',
    metadata: { title: 'Test Story', summary: 'A test.' },
    draft,
    videos,
    ...overrides,
  };
}

describe('CreateStoryBuild request', () => {
  it('builds whatever is saved right now when no version token is given', () => {
    // Pressing Build should not require first reading a draft revision and a
    // video snapshot hash. Both stay accepted for a caller that wants "exactly
    // the state I was looking at, or tell me it moved".
    expect(CreateStoryBuildSchema.parse({ scope: { kind: 'full' } })).toEqual({
      scope: { kind: 'full' },
    });
  });
});

describe('compileStoryBuild', () => {
  describe('a clip whose footage is not attached yet', () => {
    it('keeps the shot playable in a preview, as an empty sequence', () => {
      const result = compileStoryBuild(
        compilerInput(undefined, { channel: 'preview', videos: [] }),
      );

      expect(
        result.diagnostics.filter((item) => item.severity === 'error'),
      ).toEqual([]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          code: 'STORY_BUILD_CURRENT_VIDEO_REQUIRED',
        }),
      );
      const scenes = result.runtime?.graph.nodes ?? [];
      expect(scenes.length).toBeGreaterThan(0);
      // Every clip scene still exists and still carries a video renderer — the
      // player stands in for the missing footage and advances on the same
      // `media-ended` outcome, so no exit downstream changes shape.
      scenes.forEach((scene) => {
        if (scene.kind !== 'scene') return;
        const video = scene.renderers.find(
          (renderer) => renderer.rendererId === 'core.video',
        );
        if (!video) return;
        expect((video.config as { sequence: unknown[] }).sequence).toEqual([]);
      });
    });

    it('still refuses to compile a release', () => {
      const result = compileStoryBuild(
        compilerInput(undefined, { channel: 'production', videos: [] }),
      );

      expect(result.runtime).toBeNull();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'STORY_BUILD_CURRENT_VIDEO_REQUIRED',
        }),
      );
    });
  });

  it('compiles a pure-text narrative with no frozen video assets', () => {
    const result = compileStoryBuild(
      compilerInput(textDraft(), {
        format: 'text_adventure',
        videos: [],
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.includedGraphNodeIds).toEqual([]);
    expect(result.runtime).toMatchObject({
      metadata: { experienceProfile: 'narrative' },
      rendererRequirements: [
        expect.objectContaining({
          rendererId: EXPERIENCE_CORE_TEXT_RENDERER_ID,
          outcomes: [{ outcomeType: 'text-completed' }],
        }),
      ],
    });
    const entry = result.runtime?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'text.start',
    );
    const textRenderer =
      entry?.kind === 'scene'
        ? entry.renderers.find(
            (renderer) =>
              renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID,
          )
        : undefined;
    expect(entry).toMatchObject({
      kind: 'scene',
      clock: { kind: 'none' },
    });
    expect(textRenderer?.config).toMatchObject({ completion: 'continue' });
    expect(textRenderer?.config).not.toHaveProperty('title');
    expect(result.runtime?.endings[0]).not.toHaveProperty('summary');
  });

  it('compiles text and video nodes in one graph regardless of the preferred profile', () => {
    const result = compileStoryBuild(
      compilerInput(mixedDraft(), { format: 'text_adventure' }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.includedGraphNodeIds).toEqual(['clip.start']);
    expect(
      result.runtime?.rendererRequirements.map(
        (requirement) => requirement.rendererId,
      ),
    ).toEqual(
      expect.arrayContaining([
        EXPERIENCE_CORE_TEXT_RENDERER_ID,
        EXPERIENCE_CORE_VIDEO_RENDERER_ID,
      ]),
    );
  });

  it('accepts native video dimensions and presents inline without a frame profile', () => {
    const input = compilerInput(mixedDraft(), {
      format: 'text_adventure',
      frameProfile: null,
    });
    // A narrative clip keeps its intrinsic, non-1920x1080 dimensions.
    input.videos = input.videos.map((video) =>
      video.asset
        ? { ...video, asset: { ...video.asset, width: 1280, height: 720 } }
        : video,
    );

    const result = compileStoryBuild(input);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.diagnostics.some(
        (item) => item.code === 'STORY_BUILD_VIDEO_FRAME_MISMATCH',
      ),
    ).toBe(false);

    // The media asset keeps its native size and derives orientation from it.
    const videoAsset = result.runtime?.assets.find(
      (asset) => asset.kind === 'video',
    );
    expect(videoAsset).toMatchObject({
      kind: 'video',
      variants: [
        expect.objectContaining({
          orientation: 'landscape',
          width: 1280,
          height: 720,
        }),
      ],
    });

    // The video renderer presents inline at native size, not aspect-cover.
    const clipScene = result.runtime?.graph.nodes.find(
      (node) => node.kind === 'scene' && node.sceneId === 'clip.start',
    );
    const videoRenderer =
      clipScene?.kind === 'scene'
        ? clipScene.renderers.find(
            (renderer) =>
              renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID,
          )
        : undefined;
    expect(videoRenderer?.config).toMatchObject({ fit: 'native' });
  });

  it('keeps channel explicit even for a full-graph preview', () => {
    const result = compileStoryBuild(
      compilerInput(simpleDraft(), { channel: 'preview' }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.runtime).toMatchObject({
      schemaVersion: 2,
      channel: 'preview',
      gameId: PROJECT_ID,
      buildId: BUILD_ID,
    });
  });

  it('fails a required clip with no current selection instead of inventing media', () => {
    const input = compilerInput();
    input.videos[0] = {
      ...input.videos[0],
      asset: null,
    };

    const result = compileStoryBuild(input);

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'STORY_BUILD_CURRENT_VIDEO_REQUIRED' }),
      ]),
    );
  });

  it('publishes exact media with missing technical metadata and warns', () => {
    const input = compilerInput();
    input.videos[0] = {
      ...input.videos[0],
      asset: {
        ...input.videos[0].asset!,
        checksumSha256: null,
        durationMs: null,
        width: null,
        height: null,
        browserSafeMp4: null,
      },
    };

    const result = compileStoryBuild(input);

    expect(result.runtime).not.toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toContain(
      'STORY_BUILD_VIDEO_METADATA_INCOMPLETE',
    );
  });

  it('reports path totals from actual frozen durations across a choice branch', () => {
    const draft = choiceDraft();
    const input = compilerInput(draft);
    const durations = new Map([
      ['clip.start', 5_000],
      ['clip.truth', 7_000],
      ['clip.echo', 9_000],
    ]);
    input.videos = input.videos.map((video, index) => ({
      ...video,
      asset: frozenAsset(index + 1, durations.get(video.graphNodeId) as number),
    }));

    const compiled = compileStoryBuild(input);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.pathReport).toMatchObject({
      durationMinMs: 12_000,
      durationMaxMs: 14_000,
    });
  });

  /**
   * The reason path enumeration was replaced. A story that offers a choice per
   * scene multiplies out: eight 3-way choices whose branches all reconverge is
   * 6,561 distinct routes through only 25 nodes, which used to trip a 10,000-route
   * safety budget and fail the compile on a graph that is perfectly well-formed.
   * The counts here are exact, so this also pins that summing beats enumerating.
   */
  it('reports a combinatorial route count without a safety budget to blow', () => {
    const CHOICES = 8;
    const draft = wideChoiceDraft(CHOICES);
    const input = compilerInput(draft);
    input.videos = input.videos.map((video, index) => ({
      ...video,
      asset: frozenAsset(index + 1, 1_000),
    }));

    const compiled = compileStoryBuild(input);

    expect(compiled.diagnostics).toEqual([]);
    // 3^8 routes, and every route walks hub + one branch per round, plus the end.
    expect(compiled.pathReport.enumeratedPathCount).toBe(3 ** CHOICES);
    expect(compiled.pathReport.durationMinMs).toBe((CHOICES * 2 + 1) * 1_000);
    expect(compiled.pathReport.durationMaxMs).toBe((CHOICES * 2 + 1) * 1_000);
    expect(compiled.pathReport.reachableEndingIds).toEqual(['truth']);
  });

  /**
   * A dead branch contributes no route, so it must not contribute a duration
   * either. Treating its absent runtime as 0 ms would drag durationMinMs down to
   * whatever the live branch costs minus the dead one — silently wrong, and
   * invisible because the build still succeeds.
   */
  it('excludes a dead branch from the duration span rather than scoring it 0 ms', () => {
    const draft = choiceDraft();
    const broken = {
      ...draft,
      graph: {
        ...draft.graph,
        nodes: draft.graph.nodes.filter((node) => node.nodeId !== 'clip.echo'),
      },
    } as typeof draft;
    const input = compilerInput(broken);
    const durations = new Map([
      ['clip.start', 5_000],
      ['clip.truth', 7_000],
    ]);
    input.videos = input.videos.map((video, index) => ({
      ...video,
      asset: frozenAsset(index + 1, durations.get(video.graphNodeId) as number),
    }));

    const compiled = compileStoryBuild(input);

    // The dead branch is reported, not absorbed. Deleting the node drops it from
    // the scope selection too, so the scope check is what names it.
    expect(compiled.diagnostics.map((item) => item.code)).toContain(
      'STORY_BUILD_ROUTE_OUTSIDE_SCOPE',
    );
    // One surviving route: start + truth. Never 5_000 on its own.
    expect(compiled.pathReport.enumeratedPathCount).toBe(1);
    expect(compiled.pathReport.durationMinMs).toBe(12_000);
    expect(compiled.pathReport.durationMaxMs).toBe(12_000);
    expect(compiled.pathReport.reachableEndingIds).toEqual(['truth']);
  });

  /**
   * Music must cost a story that has none exactly nothing — the manifest is the
   * published artifact, so a byte of drift here is a byte of drift in every
   * release that predates the feature.
   */
  it('leaves a story without music byte-identical', () => {
    const withoutInput = compileStoryBuild(
      compilerInput(choiceDraft(), { format: 'text_adventure' }),
    );
    const withEmptyInput = compileStoryBuild(
      compilerInput(choiceDraft(), {
        format: 'text_adventure',
        musicUrls: new Map(),
      }),
    );

    expect(JSON.stringify(withEmptyInput.runtime)).toBe(
      JSON.stringify(withoutInput.runtime),
    );
    expect(JSON.stringify(withoutInput.runtime)).not.toContain('music');
  });

  it('references the same plain media URL from every scene bound to one track', () => {
    const draft = choiceDraft();
    // One theme returning on two scenes plus a second track: three bindings,
    // two files, and no `assets` entry for either.
    draft.graph.nodes[0].music = { mediaAssetId: THEME_ASSET_ID };
    draft.graph.nodes[1].music = { mediaAssetId: THEME_ASSET_ID };
    draft.graph.nodes[2].music = { mediaAssetId: ECHO_ASSET_ID };

    const compiled = compileStoryBuild(
      compilerInput(draft, {
        format: 'text_adventure',
        musicUrls: new Map([
          [THEME_ASSET_ID, musicUrl(THEME_ASSET_ID)],
          [ECHO_ASSET_ID, musicUrl(ECHO_ASSET_ID)],
        ]),
      }),
    );

    expect(compiled.diagnostics).toEqual([]);
    expect(
      (compiled.runtime?.assets ?? []).some((asset) => asset.kind === 'audio'),
    ).toBe(false);
    expect(
      (compiled.runtime?.graph.nodes ?? []).map((node) => [
        node.sceneId,
        node.kind === 'scene' ? node.music : undefined,
      ]),
    ).toEqual([
      [
        'clip.echo',
        { trackId: `audio:${ECHO_ASSET_ID}`, url: musicUrl(ECHO_ASSET_ID) },
      ],
      [
        'clip.start',
        { trackId: `audio:${THEME_ASSET_ID}`, url: musicUrl(THEME_ASSET_ID) },
      ],
      [
        'clip.truth',
        { trackId: `audio:${THEME_ASSET_ID}`, url: musicUrl(THEME_ASSET_ID) },
      ],
    ]);
  });

  /**
   * The whole point of the plain-reference design: a bed whose asset is gone is
   * silence on that scene. There is no diagnostic, no severity, no publish gate
   * — the story still plays.
   */
  it('publishes a binding whose asset no longer resolves as silence, not a diagnostic', () => {
    const draft = choiceDraft();
    draft.graph.nodes[0].music = { mediaAssetId: THEME_ASSET_ID };

    const compiled = compileStoryBuild(
      compilerInput(draft, { format: 'text_adventure', musicUrls: new Map() }),
    );

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.runtime).not.toBeNull();
    expect(JSON.stringify(compiled.runtime)).not.toContain('music');
  });

  /**
   * The cinematic player reads no scene music, so a film Build must not ship,
   * review or pay for audio nobody can hear.
   */
  it('emits no music at all for a cinematic build, bound or not', () => {
    const draft = choiceDraft();
    const unbound = compileStoryBuild(compilerInput(choiceDraft()));
    draft.graph.nodes[0].music = { mediaAssetId: THEME_ASSET_ID };

    const bound = compileStoryBuild(
      compilerInput(draft, {
        musicUrls: new Map([[THEME_ASSET_ID, musicUrl(THEME_ASSET_ID)]]),
      }),
    );

    expect(bound.diagnostics).toEqual([]);
    expect(JSON.stringify(bound.runtime)).toBe(JSON.stringify(unbound.runtime));
  });
});

describe('StoryBuildService concurrency boundaries', () => {
  const user = { userId: 'user-1' } as never;
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
    }),
  };
  const storage = { createReadUrl: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('keeps frozen media readable when only advisory metadata changed', async () => {
    const frozen = {
      logicalKey: 'video:START',
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      checksumSha256: CHECKSUM,
      contentType: 'video/mp4',
      durationMs: 7_000,
      width: 1920,
      height: 1080,
      browserSafeMp4: true,
      sizeBytes: 7_000n,
      build: {
        status: StoryBuildStatus.ready,
        kind: StoryBuildKind.preview,
        scope: { kind: 'full' },
        runtimeSchemaVersion: 2,
        experiencePublication: null,
      },
      asset: {
        id: ASSET_ID,
        kind: MediaAssetKind.video,
        status: MediaAssetStatus.ready,
        moderationStatus: MediaAssetModerationStatus.approved,
        deletedAt: null,
        sizeBytes: 7_000n,
        storageProvider: MediaStorageProvider.external_url,
        bucket: null,
        region: null,
        objectKey: null,
        externalUrl: 'https://cdn.example.test/video.mp4',
        contentType: 'video/mp4',
        placements: [],
      },
      variant: {
        id: VARIANT_ID,
        assetId: ASSET_ID,
        variantKey: 'original',
        status: MediaAssetVariantStatus.ready,
        checksumSha256: 'b'.repeat(64),
        contentType: 'video/mp4',
        durationMs: 7_000,
        width: 1920,
        height: 1080,
        sizeBytes: 7_000n,
        metadata: { browserSafeMp4: true },
        deletedAt: null,
        placements: [],
      },
    };
    const prisma = {
      storyBuildAsset: { findFirst: jest.fn().mockResolvedValue(frozen) },
    };
    storage.createReadUrl.mockResolvedValueOnce({
      url: 'https://signed.example.test/video.mp4',
      expiresAt: null,
    });
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    await expect(
      service.issueBuildAssetReadUrl(
        user,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).resolves.toEqual({
      url: 'https://signed.example.test/video.mp4',
      expiresAt: null,
    });
  });

  it('takes the project write fence before materializing a Build snapshot', async () => {
    const tx = { storyBuild: { findUnique: jest.fn() } };
    const prisma = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const locked = new Error('agent applying');
    const guard = {
      assertHumanWriteAllowed: jest.fn().mockRejectedValue(locked),
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      guard as never,
    );

    await expect(
      service.createBuild(
        user,
        WORKSPACE_ID,
        PROJECT_ID,
        {
          expectedDraftRevision: 1,
          expectedVideoSnapshotHash: 'a'.repeat(64),
          scope: { kind: 'full' },
        },
        'locked-build',
      ),
    ).rejects.toBe(locked);
    expect(guard.assertHumanWriteAllowed).toHaveBeenCalledWith(tx, PROJECT_ID);
    expect(tx.storyBuild.findUnique).not.toHaveBeenCalled();
  });

  it('rejects reuse of an Idempotency-Key with another body', async () => {
    const existingFingerprint = storyBuildRequestFingerprint({
      expectedDraftRevision: 1,
      expectedVideoSnapshotHash: '1'.repeat(64),
      scope: { kind: 'full' },
    });
    const prisma = {
      storyBuild: {
        findUnique: jest.fn().mockResolvedValue({
          requestFingerprint: existingFingerprint,
        }),
      },
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    await expect(
      service.createBuild(
        user,
        WORKSPACE_ID,
        PROJECT_ID,
        {
          expectedDraftRevision: 2,
          expectedVideoSnapshotHash: '2'.repeat(64),
          scope: { kind: 'full' },
        },
        'same-key',
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_BUILD_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('recomputes and CAS-checks the canonical video snapshot in Serializable', async () => {
    const draft = simpleDraft();
    const tx = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(null) },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue({
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          title: 'Story',
          summary: null,
          format: 'interactive_film',
          defaultLocale: 'en-US',
          frameProfile: 'landscape_16_9',
        }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 3,
          schemaVersion: 'interactive-story-draft-v1',
          content: draft,
          contentHash: canonicalJsonHash(draft),
        }),
      },
      storyVideoSelection: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown, options) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        return work(tx);
      }),
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    await expect(
      service.createBuild(
        user,
        WORKSPACE_ID,
        PROJECT_ID,
        {
          expectedDraftRevision: 3,
          expectedVideoSnapshotHash: 'f'.repeat(64),
          scope: { kind: 'full' },
        },
        'hash-cas',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_BUILD_VIDEO_SNAPSHOT_CONFLICT',
        actualVideoSnapshotHash: storyVideoSnapshotHash([
          {
            graphNodeId: 'clip.start',
            selectionVersion: 0,
            assetId: null,
            variantId: null,
            checksumSha256: null,
            contentType: null,
            durationMs: null,
            width: null,
            height: null,
            browserSafeMp4: null,
          },
        ]),
      },
    });
  });

  it('returns a controlled retired-contract error for an old Build row', async () => {
    const prisma = {
      storyBuild: {
        findFirst: jest.fn().mockResolvedValue({ runtimeSchemaVersion: 1 }),
      },
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    await expect(
      service.getBuild(user, WORKSPACE_ID, PROJECT_ID, BUILD_ID),
    ).rejects.toMatchObject({
      response: { code: 'STORY_BUILD_SCHEMA_RETIRED' },
    });
  });

  it('materializes a pure-text Build without querying or freezing video assets', async () => {
    const draft = textDraft();
    const revision = {
      id: REVISION_ID,
      storyProjectId: PROJECT_ID,
      number: 1,
      sourceDraftRevision: 3,
      schemaVersion: 'interactive-story-draft-v1',
      content: draft,
      contentHash: canonicalJsonHash(draft),
      label: null,
      source: StoryRevisionSource.creator,
      createdByUserId: 'user-1',
      createdAt: new Date(),
    };
    let buildData: Record<string, unknown> | null = null;
    const findSelections = jest.fn();
    const freezeAsset = jest.fn();
    const freezeClip = jest.fn();
    const tx = {
      storyBuild: {
        findUnique: jest.fn(({ where }: { where: { id?: string } }) => {
          if (!where.id) return null;
          const data = buildData as Record<string, unknown>;
          return {
            ...data,
            id: where.id,
            createdAt: new Date(),
            updatedAt: new Date(),
            experiencePublication: null,
            assets: [],
          };
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          buildData = { ...data, version: 0 };
          return buildData;
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          buildData = {
            ...(buildData as Record<string, unknown>),
            ...data,
            version: 1,
          };
          return buildData;
        }),
      },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue({
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          title: 'A Text Story',
          summary: null,
          format: 'text_adventure',
          defaultLocale: 'en-US',
          frameProfile: 'landscape_16_9',
        }),
        update: jest.fn().mockResolvedValue({ nextBuildNumber: 2 }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 3,
          schemaVersion: 'interactive-story-draft-v1',
          content: draft,
          contentHash: canonicalJsonHash(draft),
        }),
      },
      storyVideoSelection: { findMany: findSelections },
      storyRevision: { findUnique: jest.fn().mockResolvedValue(revision) },
      storyBuildAsset: { create: freezeAsset },
      storyVideoBuildClip: { create: freezeClip },
    };
    const prisma = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const guard = { assertHumanWriteAllowed: jest.fn() };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      guard as never,
    );

    const result = await service.createBuild(
      user,
      WORKSPACE_ID,
      PROJECT_ID,
      {
        expectedDraftRevision: 3,
        expectedVideoSnapshotHash: storyVideoSnapshotHash([]),
        scope: { kind: 'full' },
      },
      'pure-text',
    );

    expect(result).toMatchObject({
      status: StoryBuildStatus.ready,
      assets: [],
      videoSnapshotHash: storyVideoSnapshotHash([]),
      runtimeJson: {
        metadata: { experienceProfile: 'narrative' },
      },
    });
    expect(guard.assertHumanWriteAllowed).toHaveBeenCalledWith(tx, PROJECT_ID);
    expect(findSelections).not.toHaveBeenCalled();
    expect(freezeAsset).not.toHaveBeenCalled();
    expect(freezeClip).not.toHaveBeenCalled();
  });

  it('freezes exact asset and video-clip rows with no mutable recipe fields', async () => {
    const draft = simpleDraft();
    const entry: StoryVideoSnapshotEntry = {
      graphNodeId: 'clip.start',
      selectionVersion: 4,
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      checksumSha256: CHECKSUM,
      contentType: 'video/mp4',
      durationMs: 7_000,
      width: 1920,
      height: 1080,
      browserSafeMp4: true,
    };
    const variant = {
      id: VARIANT_ID,
      assetId: ASSET_ID,
      variantKey: 'original',
      kind: 'original',
      status: MediaAssetVariantStatus.ready,
      contentType: 'video/mp4',
      sizeBytes: 7_000n,
      width: 1920,
      height: 1080,
      durationSeconds: 7,
      durationMs: 7_000,
      checksumSha256: CHECKSUM,
      metadata: { browserSafeMp4: true },
      deletedAt: null,
      placements: [],
    };
    const asset = {
      id: ASSET_ID,
      workspaceId: WORKSPACE_ID,
      kind: MediaAssetKind.video,
      storageProvider: MediaStorageProvider.external_url,
      bucket: null,
      region: null,
      objectKey: null,
      externalUrl: 'https://cdn.example.test/video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 7_000n,
      status: MediaAssetStatus.ready,
      moderationStatus: MediaAssetModerationStatus.approved,
      deletedAt: null,
      placements: [],
    };
    const selection = {
      id: '0197f4a2-0800-7000-8000-000000000008',
      storyProjectId: PROJECT_ID,
      graphNodeId: 'clip.start',
      version: 4,
      currentAssetId: ASSET_ID,
      currentVariantId: VARIANT_ID,
      currentChecksumSha256: CHECKSUM,
      currentContentType: 'video/mp4',
      currentDurationMs: 7_000,
      currentWidth: 1920,
      currentHeight: 1080,
      currentBrowserSafeMp4: true,
      currentAsset: asset,
      currentVariant: variant,
    };
    const revision = {
      id: REVISION_ID,
      storyProjectId: PROJECT_ID,
      number: 1,
      sourceDraftRevision: 3,
      schemaVersion: 'interactive-story-draft-v1',
      content: draft,
      contentHash: canonicalJsonHash(draft),
      label: null,
      source: StoryRevisionSource.creator,
      createdByUserId: 'user-1',
      createdAt: new Date(),
    };
    let buildData: Record<string, unknown> | null = null;
    let frozenAssetData: Record<string, unknown> | null = null;
    let frozenClipData: Record<string, unknown> | null = null;
    const operations: string[] = [];
    const tx = {
      storyBuild: {
        findUnique: jest.fn(({ where }: { where: { id?: string } }) => {
          if (!where.id) return null;
          const data = buildData as Record<string, unknown>;
          const frozen = frozenAssetData as Record<string, unknown>;
          return {
            ...data,
            id: where.id,
            buildNumber: data.buildNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: data.completedAt,
            experiencePublication: null,
            assets: frozen
              ? [
                  {
                    ...frozen,
                    id: '0197f4a2-0800-7000-8000-000000000009',
                    buildId: where.id,
                    createdAt: new Date(),
                    videoClip: { graphNodeId: 'clip.start' },
                    asset: {
                      ...asset,
                    },
                    variant: {
                      ...variant,
                    },
                  },
                ]
              : [],
          };
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          operations.push(`build:${String(data.status)}`);
          buildData = { ...data, version: 0 };
          return buildData;
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          operations.push(`build:${String(data.status)}`);
          buildData = {
            ...(buildData as Record<string, unknown>),
            ...data,
            version: 1,
          };
          return buildData;
        }),
      },
      storyProject: {
        findFirst: jest.fn().mockResolvedValue({
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          title: 'Story',
          summary: null,
          format: 'interactive_film',
          defaultLocale: 'en-US',
          frameProfile: 'landscape_16_9',
        }),
        update: jest.fn().mockResolvedValue({ nextBuildNumber: 2 }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          revision: 3,
          schemaVersion: 'interactive-story-draft-v1',
          content: draft,
          contentHash: canonicalJsonHash(draft),
        }),
      },
      storyVideoSelection: {
        findMany: jest.fn().mockResolvedValue([selection]),
      },
      storyRevision: {
        findUnique: jest.fn().mockResolvedValue(revision),
      },
      storyBuildAsset: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          operations.push('asset');
          frozenAssetData = data;
          return {
            ...data,
            id: '0197f4a2-0800-7000-8000-000000000009',
          };
        }),
      },
      storyVideoBuildClip: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          operations.push('clip');
          frozenClipData = data;
          return data;
        }),
      },
    };
    const prisma = {
      storyBuild: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(({ where }: { where: { id: string } }) =>
          tx.storyBuild.findUnique({ where: { id: where.id } }),
        ),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new StoryBuildService(
      prisma as never,
      permissions as never,
      storage as never,
      { assertHumanWriteAllowed: jest.fn() } as never,
    );

    const result = await service.createBuild(
      user,
      WORKSPACE_ID,
      PROJECT_ID,
      {
        expectedDraftRevision: 3,
        expectedVideoSnapshotHash: storyVideoSnapshotHash([entry]),
        scope: { kind: 'full' },
      },
      'freeze-exact',
    );

    expect(result.status).toBe(StoryBuildStatus.ready);
    expect(result.runtimeSchemaVersion).toBe(2);
    expect(frozenAssetData).toMatchObject({
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      checksumSha256: CHECKSUM,
      contentType: 'video/mp4',
      durationMs: 7_000,
      width: 1920,
      height: 1080,
      browserSafeMp4: true,
    });
    expect(frozenClipData).toMatchObject({
      graphNodeId: 'clip.start',
      checksumSha256: CHECKSUM,
      durationMs: 7_000,
      browserSafeMp4: true,
    });
    expect(frozenClipData).not.toHaveProperty('prompt');
    expect(frozenClipData).not.toHaveProperty('spec');
    expect(buildData).toMatchObject({
      kind: StoryBuildKind.production,
      sourceDraftRevision: 3,
      videoSnapshotHash: storyVideoSnapshotHash([entry]),
      runtimeSchemaVersion: 2,
    });
    expect(operations).toEqual([
      'build:compiling',
      'asset',
      'clip',
      'build:ready',
    ]);

    // browserSafeMp4 is now purely informational: a frozen asset that becomes a
    // browser-unsafe MP4 but is otherwise technically identical is NOT drift.
    variant.metadata = { browserSafeMp4: false };
    const stillValid = await service.getBuild(
      user,
      WORKSPACE_ID,
      PROJECT_ID,
      result.id,
    );
    expect(stillValid.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'STORY_BUILD_ASSET_METADATA_CHANGED',
      }),
    );

    // A genuine technical change (duration) is still detected as frozen drift.
    variant.durationMs = 8_000;
    const drifted = await service.getBuild(
      user,
      WORKSPACE_ID,
      PROJECT_ID,
      result.id,
    );
    expect(
      drifted.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      ),
    ).toEqual([]);
    expect(drifted.runtimeJson).not.toBeNull();
    expect(drifted.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'STORY_BUILD_ASSET_METADATA_CHANGED',
        entityId: ASSET_ID,
      }),
    );
  });
});
