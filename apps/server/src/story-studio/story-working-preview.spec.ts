import { Prisma } from '@prisma/client';
import { ExperienceRuntimeManifestSchema } from '@repo/shared/experience-runtime';
import { canonicalJsonHash } from './canonical-json';
import { buildInteractiveFilmTestBundle } from './__tests__/interactive-film-test-bundle';
import { INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION } from './interactive-film.schema';
import { StoryWorkingPreviewController } from './story-working-preview.controller';
import { StoryWorkingPreviewService } from './story-working-preview.service';
import { storySubtitleTimeline } from './story-subtitle-tracks';
import { storyVideoSnapshotHash } from './story-video-production.schema';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const COVER_ASSET_ID = '0197f4a2-0800-7000-8000-00000000000a';

/** A ready cover image resolving straight to its permanent public URL. */
function previewCoverRow() {
  return {
    id: COVER_ASSET_ID,
    storageProvider: 'external_url',
    bucket: null,
    region: null,
    objectKey: null,
    externalUrl: 'https://assets.example/cover.jpg',
    status: 'ready',
    moderationStatus: 'approved',
    deletedAt: null,
    contentType: null,
    width: null,
    height: null,
    checksumSha256: null,
    placements: [],
  };
}

type Draft = ReturnType<typeof buildInteractiveFilmTestBundle>['draftContent'];

function scopedService(
  draftContent: Draft,
  sequences: unknown[] = previewSequences(draftContent),
  schemaVersion: string = INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  cover: { coverAssetId: string; row: unknown } | null = null,
) {
  const contentHash = canonicalJsonHash(draftContent);
  const tx = {
    storyDraft: {
      findUnique: jest.fn().mockResolvedValue({
        revision: 9,
        schemaVersion,
        content: draftContent,
        contentHash,
      }),
    },
    storyChapter: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: uuidAt(9),
          rank: 0,
          nodeIds: draftContent.graph.nodes.map((node) => node.nodeId),
          entryNodeId: draftContent.graph.entryNodeId,
        },
      ]),
    },
    storyStoryboardSequence: {
      findMany: jest.fn().mockResolvedValue(sequences),
    },
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue(cover?.row ?? null),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const project = {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    frameProfile: 'landscape_16_9',
    defaultLocale: 'zh-CN',
    title: 'Branching Film Test',
    summary: 'A branching interactive film.',
    coverAssetId: cover?.coverAssetId ?? null,
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({ project }),
  };
  const assetUrls = {
    resolveVariant: jest.fn(
      (asset: { externalUrl: string | null }) => asset.externalUrl,
    ),
  };
  return {
    contentHash,
    project,
    prisma,
    tx,
    assetUrls,
    service: new StoryWorkingPreviewService(
      prisma as never,
      permissions as never,
      assetUrls as never,
    ),
  };
}

function previewSequences(draft: Draft) {
  return draft.graph.nodes
    .filter((node) => node.kind === 'clip')
    .map((node, index) => {
      const checksum = `${index + 1}`.padStart(64, '0');
      const assetId = uuidAt(100 + index);
      const variantId = uuidAt(300 + index);
      const variant = {
        id: variantId,
        assetId,
        variantKey: 'original',
        kind: 'original',
        status: 'ready',
        deletedAt: null,
        contentType: 'video/mp4',
        checksumSha256: checksum,
        width: 1920,
        height: 1080,
        durationSeconds: 15,
        // Nullable on the real variant row; tests null it to model unprobed.
        durationMs: 15_000 as number | null,
        sizeBytes: BigInt(1_000 + index),
        metadata: { browserSafeMp4: true } as Record<string, unknown>,
        createdAt: new Date(),
        updatedAt: new Date(),
        placements: [],
      };
      const mediaAsset = {
        id: assetId,
        workspaceId: WORKSPACE_ID,
        kind: 'video',
        status: 'ready',
        moderationStatus: 'approved',
        deletedAt: null,
        storageProvider: 'external_url',
        bucket: null,
        region: null,
        objectKey: null,
        externalUrl: `https://assets.example/${node.clipKey}.mp4`,
        contentType: 'video/mp4',
        checksumSha256: checksum,
        width: 1920,
        height: 1080,
        durationSeconds: 15,
        sizeBytes: BigInt(1_000 + index),
        placements: [],
        variants: [variant],
      };
      return {
        id: uuidAt(700 + index),
        storyProjectId: PROJECT_ID,
        plotNodeId: node.nodeId,
        stableKey: `seq.${node.clipKey}`,
        status: 'current',
        version: 0,
        clips: [
          {
            id: uuidAt(500 + index),
            stableKey: `shot.${node.clipKey}.a`,
            kind: 'video',
            track: 'visual',
            startMs: 0,
            rank: 0,
            durationMs: 15_000,
            version: index + 3,
            status: 'current',
            selectedMediaVersion: {
              id: uuidAt(600 + index),
              mediaAssetId: assetId,
              archivedAt: null,
              preferredVariant: null,
              mediaAsset,
            },
          },
        ],
      };
    });
}

describe('StoryWorkingPreviewService', () => {
  it('includes current shot subtitles in playtest and warns without playing a stale track', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const sequences = previewSequences(draft);
    const clip = sequences[0].clips[0];
    const tracks = [
      {
        language: 'en-US',
        timelineFingerprint: storySubtitleTimeline(sequences[0]).fingerprint,
        fileName: 'en.srt',
        format: 'srt',
        cues: [{ startMs: 0, endMs: 2000, text: 'Current dialogue' }],
      },
    ];
    Object.assign(sequences[0], { subtitleTracks: tracks });
    const preview = await scopedService(
      draft,
      sequences,
    ).service.getWorkingPreview(USER as never, PROJECT_ID);
    const runtime = ExperienceRuntimeManifestSchema.parse(preview.runtime);
    expect(runtime.compatibility.requiredCapabilities).toContain(
      'core.video.subtitles',
    );
    const shots = runtime.graph.nodes
      .flatMap((node) => (node.kind === 'scene' ? node.renderers : []))
      .filter((renderer) => renderer.rendererId === 'core.video')
      .flatMap((renderer) => renderer.config.sequence as unknown[]);
    expect(shots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clipId: clip.id,
          subtitles: [{ language: 'en-US', cues: tracks[0].cues }],
        }),
      ]),
    );
    tracks[0].timelineFingerprint = 'f'.repeat(64);
    const stale = await scopedService(
      draft,
      sequences,
    ).service.getWorkingPreview(USER as never, PROJECT_ID);
    expect(stale.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_SUBTITLE_REVIEW_REQUIRED',
          severity: 'warning',
        }),
      ]),
    );
    expect(
      ExperienceRuntimeManifestSchema.parse(stale.runtime).compatibility
        .requiredCapabilities,
    ).not.toContain('core.video.subtitles');
  });
  it('hides node captions when a segment is skipped due to an unavailable playback URL', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const sequences = previewSequences(draft),
      node = sequences[0];
    const first = node.clips[0];
    node.clips.push({
      ...first,
      id: uuidAt(998),
      startMs: 15000,
      selectedMediaVersion: {
        ...first.selectedMediaVersion,
        id: uuidAt(997),
        mediaAsset: {
          ...first.selectedMediaVersion.mediaAsset,
          externalUrl: 'http://localhost:9999/unavailable.mp4',
        },
      },
    });
    Object.assign(node, {
      subtitleTracks: [
        {
          language: 'en-US',
          timelineFingerprint: storySubtitleTimeline(node).fingerprint,
          fileName: 'node.srt',
          format: 'srt',
          cues: [{ startMs: 0, endMs: 30000, text: 'Whole node' }],
        },
      ],
    });
    const preview = await scopedService(
      draft,
      sequences,
    ).service.getWorkingPreview(USER as never, PROJECT_ID);
    expect(preview.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'STORY_SUBTITLE_PLAYBACK_INCOMPLETE' }),
      ]),
    );
    expect(
      ExperienceRuntimeManifestSchema.parse(preview.runtime).compatibility
        .requiredCapabilities,
    ).not.toContain('core.video.subtitles');
  });
  it('identifies an invalid choice effect and its canvas destination', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    draft.storyBible.stateVariables = [
      {
        key: 'flags.asked',
        name: { 'zh-CN': '已询问' },
        valueType: 'boolean',
        initialValue: false,
      },
    ];
    const node = draft.graph.nodes[0];
    if (node.exit.kind !== 'choice') throw new Error('Choice fixture missing.');
    node.exit.choices[1].effects = [
      { kind: 'add', key: 'flags.asked', amount: 1 },
    ];

    const preview = await scopedService(draft).service.getWorkingPreview(
      USER as never,
      PROJECT_ID,
      uuidAt(9),
    );

    expect(preview.runtime).toBeNull();
    const diagnostic = preview.diagnostics[0];
    expect(diagnostic).toMatchObject({
      code: 'STORY_WORKING_PREVIEW_EFFECT_TYPE_MISMATCH',
      entityType: 'node',
      entityId: node.nodeId,
      chapterId: uuidAt(9),
    });
    expect(diagnostic?.details).toEqual({
      kind: 'state-effect-type',
      nodeTitle:
        node.kind === 'decision'
          ? node.exit.prompt['zh-CN']
          : node.name || node.nodeId,
      choiceLabel: node.exit.choices[1].label['zh-CN'],
      effectIndex: 1,
      variableName: '已询问',
      operation: 'add',
      variableType: 'boolean',
    });
    expect(preview.diagnostics[0]?.message).toContain(
      'add requires a number variable',
    );
  });

  it('gives chapter and whole-story previews distinct stable build identities', async () => {
    const { service } = scopedService(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const whole = await service.getWorkingPreview(USER as never, PROJECT_ID);
    const chapter = await service.getWorkingPreview(
      USER as never,
      PROJECT_ID,
      uuidAt(9),
    );
    const repeated = await service.getWorkingPreview(
      USER as never,
      PROJECT_ID,
      uuidAt(9),
    );
    expect(chapter.runtime).not.toBeNull();
    expect(chapter.runtime?.buildId).not.toBe(whole.runtime?.buildId);
    expect(repeated.runtime?.buildId).toBe(chapter.runtime?.buildId);
  });

  it('replaces the preview identity after project presentation metadata changes', async () => {
    const { service, project } = scopedService(
      buildInteractiveFilmTestBundle().draftContent,
    );
    const first = await service.getWorkingPreview(USER as never, PROJECT_ID);
    project.title = 'Updated title';
    const second = await service.getWorkingPreview(USER as never, PROJECT_ID);
    expect(second.runtime?.metadata).not.toEqual(first.runtime?.metadata);
    expect(second.runtime?.buildId).not.toBe(first.runtime?.buildId);
  });

  it.each([1, 2])(
    'preserves %i untouched options and plays an unfilmed scene as text for four seconds',
    async (optionCount) => {
      const draft = buildInteractiveFilmTestBundle().draftContent;
      draft.graph = {
        entryNodeId: 'opening',
        nodes: [
          {
            kind: 'clip',
            nodeId: 'opening',
            clipKey: 'OPENING',
            name: 'The rain',
            description: 'A cat waits.\nThe door opens.',
            interactions: [],
            exit: {
              kind: 'auto',
              routes: [{ target: { kind: 'node', nodeId: 'choice' } }],
            },
          },
          {
            kind: 'decision',
            nodeId: 'choice',
            exit: {
              kind: 'choice',
              decisionId: 'choice',
              prompt: { 'zh-CN': '' },
              choices: Array.from({ length: optionCount }, (_, index) => ({
                choiceId: `option:${index + 1}`,
                label: {},
                target: null,
              })),
            },
          },
        ],
      };
      const original = structuredClone(draft);
      const preview = await scopedService(draft, []).service.getWorkingPreview(
        USER as never,
        PROJECT_ID,
      );
      expect(
        preview.diagnostics.filter((item) => item.severity === 'error'),
      ).toEqual([]);
      const runtime = ExperienceRuntimeManifestSchema.parse(preview.runtime);
      const opening = runtime.graph.nodes.find(
        (node) => node.sceneId === 'opening',
      );
      if (opening?.kind !== 'scene') throw new Error('Opening missing');
      expect(opening.clock).toEqual({ kind: 'fixed', durationMs: 4000 });
      expect(
        opening.renderers.find(
          (renderer) => renderer.rendererId === 'core.text',
        )?.config,
      ).toMatchObject({
        title: { 'zh-CN': 'The rain' },
        body: { 'zh-CN': 'A cat waits.\nThe door opens.' },
        completion: 'passive',
      });
      const choice = opening.renderers.find(
        (renderer) => renderer.rendererId === 'core.choice',
      );
      expect(choice?.config).toMatchObject({
        prompt: { 'zh-CN': '请选择' },
        initiallyOpen: false,
      });
      expect((choice?.config as { choices: unknown[] }).choices).toHaveLength(
        optionCount,
      );
      expect(opening.eventBindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            on: { type: 'scene.clock-ended', sourceId: 'opening' },
          }),
        ]),
      );
      expect(runtime.graph.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sceneId: 'preview:unconnected-end',
            clock: { kind: 'none' },
            eventBindings: [
              expect.objectContaining({
                routes: [
                  expect.objectContaining({
                    actions: [
                      { kind: 'ending.complete', endingId: 'film.complete' },
                    ],
                  }),
                ],
              }),
            ],
          }),
        ]),
      );
      expect(draft).toEqual(original);
    },
  );

  it('keeps a connected route and an unconnected option distinct when the prompt is blank', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    draft.graph = {
      entryNodeId: 'choice',
      nodes: [
        {
          kind: 'decision',
          nodeId: 'choice',
          exit: {
            kind: 'choice',
            decisionId: 'choice',
            prompt: {},
            choices: [
              {
                choiceId: 'stay',
                label: { 'en-US': 'Stay' },
                target: { kind: 'node', nodeId: 'last' },
              },
              {
                choiceId: 'leave',
                label: { 'en-US': 'Leave' },
                target: null,
              },
            ],
          },
        },
        {
          kind: 'clip',
          nodeId: 'last',
          clipKey: 'LAST',
          interactions: [],
          exit: { kind: 'auto', routes: [{ target: null }] },
        },
      ],
    };
    const preview = await scopedService(draft, []).service.getWorkingPreview(
      USER as never,
      PROJECT_ID,
    );
    expect(
      preview.diagnostics.filter((item) => item.severity === 'error'),
    ).toEqual([]);
    const runtime = ExperienceRuntimeManifestSchema.parse(preview.runtime);
    const decision = runtime.graph.nodes.find(
      (node) => node.sceneId === 'choice',
    );
    if (decision?.kind !== 'scene') throw new Error('Choice missing');
    expect(decision.renderers[0]?.config).toMatchObject({
      initiallyOpen: true,
    });
    expect(
      decision.eventBindings[0]?.routes.map((route) => route.actions),
    ).toEqual([
      [{ kind: 'scene.goto', sceneId: 'last' }],
      [{ kind: 'scene.goto', sceneId: 'preview:unconnected-end' }],
    ]);
  });

  /**
   * The playtest runs the same ExperiencePlayer the published game does, so this
   * is where a creator actually sees the cover they just picked. Without it the
   * only way to find out whether a cover works would be to publish.
   */
  it('returns the project cover beside the Preview manifest', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, tx } = scopedService(
      draft,
      previewSequences(draft),
      INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
      { coverAssetId: COVER_ASSET_ID, row: previewCoverRow() },
    );

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.diagnostics).toEqual([]);
    const runtime = preview.runtime as { assets: { kind: string }[] };
    expect(preview.coverUrl).toBe('https://assets.example/cover.jpg');
    expect(runtime.assets.some((asset) => asset.kind === 'image')).toBe(false);
    expect(tx.mediaAsset.findFirst).toHaveBeenCalledTimes(1);
  });

  it('costs a Preview no query at all when the project has no cover', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, tx } = scopedService(draft);

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.coverUrl).toBeNull();
    expect(tx.mediaAsset.findFirst).not.toHaveBeenCalled();
  });

  it('uses the first film as entry when the canvas has not chosen one yet', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    draft.graph.entryNodeId = null;
    const { service, tx } = scopedService(draft);

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.runtime).toMatchObject({
      graph: { entrySceneId: draft.graph.nodes[0]?.nodeId },
    });
    expect(preview.diagnostics).toEqual([]);
    expect(tx.storyStoryboardSequence.findMany).toHaveBeenCalledTimes(1);
  });

  it('starts a clicked scene in that chapter even when the chapter entry is empty', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const foreignNodeId = draft.graph.nodes[0]?.nodeId;
    const chapterNodeIds = draft.graph.nodes
      .map((node) => node.nodeId)
      .filter((nodeId) => nodeId !== foreignNodeId);
    const clickedNodeId = chapterNodeIds[1];
    if (!foreignNodeId || !clickedNodeId)
      throw new Error('Fixture nodes missing.');
    draft.graph.entryNodeId = null;
    const chapterId = uuidAt(9);
    const { service, tx } = scopedService(draft);
    tx.storyChapter.findMany.mockResolvedValue([
      {
        id: chapterId,
        rank: 0,
        nodeIds: chapterNodeIds,
        entryNodeId: null,
      },
      {
        id: uuidAt(10),
        rank: 1,
        nodeIds: [foreignNodeId],
        entryNodeId: foreignNodeId,
      },
    ]);

    const fromClick = await service.getWorkingPreview(
      USER as never,
      PROJECT_ID,
      chapterId,
      clickedNodeId,
    );
    const fromChapter = await service.getWorkingPreview(
      USER as never,
      PROJECT_ID,
      chapterId,
    );

    expect(fromClick.runtime).toMatchObject({
      graph: { entrySceneId: clickedNodeId },
    });
    expect(fromChapter.runtime).toMatchObject({
      graph: { entrySceneId: chapterNodeIds[0] },
    });
    expect(fromClick.runtime).not.toMatchObject({
      graph: { entrySceneId: foreignNodeId },
    });
    expect(fromChapter.runtime).not.toMatchObject({
      graph: { entrySceneId: foreignNodeId },
    });
  });

  it('does not block Preview on an unfinished player choice', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const choiceNode = draft.graph.nodes.find(
      (node) => node.exit.kind === 'choice',
    );
    if (!choiceNode || choiceNode.exit.kind !== 'choice') {
      throw new Error('Choice fixture missing.');
    }
    choiceNode.exit.prompt = {};
    choiceNode.exit.choices[0].label = {};
    const preview = await scopedService(draft).service.getWorkingPreview(
      USER as never,
      PROJECT_ID,
    );

    expect(preview.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
    );
    expect(preview.runtime).not.toBeNull();
  });

  it('strictly rejects a saved Preview whose chapter projection is incomplete', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, tx } = scopedService(draft);
    tx.storyChapter.findMany.mockResolvedValue([
      {
        id: uuidAt(9),
        rank: 0,
        nodeIds: [],
        entryNodeId: draft.graph.entryNodeId,
      },
    ]);

    await expect(
      service.getWorkingPreview(USER as never, PROJECT_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_CHAPTER_GRAPH_PARTITION_INVALID',
      }) as unknown,
    });
  });

  it('compiles the current draft and exact video selections to a Preview manifest', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, contentHash, prisma, tx } = scopedService(draft);

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.draftRevision).toBe(9);
    expect(preview.contentHash).toBe(contentHash);
    expect(preview.videoSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(preview.runtime).toMatchObject({
      manifestType: 'fizzdragon.experience',
      schemaVersion: 2,
      channel: 'preview',
      gameId: PROJECT_ID,
      buildId: expect.stringMatching(/^preview:[a-f0-9]{64}$/) as unknown,
      contentVersion: preview.runtime?.buildId,
      graph: { entrySceneId: draft.graph.entryNodeId },
    });
    expect(preview.diagnostics).toEqual([]);
    expect(preview.pathReport).toMatchObject({
      reachableTerminalNodeIds: [
        'clip:E01',
        'clip:E02',
        'clip:E03',
        'clip:E04',
      ],
    });
    expect(preview.sources).toHaveLength(21);
    expect(preview.sources[0]).toMatchObject({
      selection: 'current',
      selectionVersion: 3,
    });
    const calls = tx.storyStoryboardSequence.findMany.mock
      .calls as unknown as Array<
      [
        {
          where: {
            storyProjectId: string;
            plotNodeId: { in: string[] };
            status: unknown;
          };
          include: unknown;
        },
      ]
    >;
    const query = calls[0]?.[0];
    expect(query?.where).toEqual({
      storyProjectId: PROJECT_ID,
      plotNodeId: {
        in: draft.graph.nodes
          .filter((node) => node.kind === 'clip')
          .map((node) => node.nodeId),
      },
      status: { not: 'archived' },
    });
    expect(query?.include).toBeDefined();
  });

  it('changes the complete Preview identity when the exact current video changes', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const firstPreview = await scopedService(
      draft,
      previewSequences(draft),
    ).service.getWorkingPreview(USER as never, PROJECT_ID);
    const changedSequences = previewSequences(draft);
    const changedClip = changedSequences[0]?.clips[0];
    if (!changedClip) throw new Error('Fixture clip missing.');
    const changedAssetId = uuidAt(900);
    const changedVariantId = uuidAt(901);
    changedClip.version += 1;
    changedClip.selectedMediaVersion.mediaAssetId = changedAssetId;
    changedClip.selectedMediaVersion.mediaAsset.id = changedAssetId;
    changedClip.selectedMediaVersion.mediaAsset.variants[0].assetId =
      changedAssetId;
    changedClip.selectedMediaVersion.mediaAsset.variants[0].id =
      changedVariantId;

    const secondPreview = await scopedService(
      draft,
      changedSequences,
    ).service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(secondPreview.videoSnapshotHash).not.toBe(
      firstPreview.videoSnapshotHash,
    );
    expect(secondPreview.runtime?.buildId).not.toBe(
      firstPreview.runtime?.buildId,
    );
    expect(secondPreview.runtime?.contentVersion).not.toBe(
      firstPreview.runtime?.contentVersion,
    );
  });

  it('keeps Preview playable with an empty shot when a scene has no sequence', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const sequences = previewSequences(draft);
    const missing = sequences.shift();
    if (!missing) throw new Error('Fixture sequence missing.');
    const { service } = scopedService(draft, sequences);

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.runtime).not.toBeNull();
    expect(preview.sources).toHaveLength(20);
    expect(preview.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_SEQUENCE_REQUIRED',
          entityId: missing.plotNodeId,
          severity: 'warning',
        }),
      ]),
    );
  });

  it('keeps Preview playable with an empty shot when a clip has no media', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const sequences = previewSequences(draft);
    const bare = sequences[0]?.clips[0];
    if (!bare) throw new Error('Fixture clip missing.');
    Object.assign(bare, { selectedMediaVersion: null });
    const { service } = scopedService(draft, sequences);

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.runtime).not.toBeNull();
    expect(preview.sources).toHaveLength(20);
    expect(preview.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_CLIP_MEDIA_REQUIRED',
          severity: 'warning',
          details: expect.objectContaining({ kind: 'shot' }) as unknown,
        }),
      ]),
    );
    expect(preview.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_WORKING_PREVIEW_CLIP_MEDIA_MISSING',
        }),
      ]),
    );
  });

  it('keeps Preview playable and warns when probed variant metadata is missing', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const sequences = previewSequences(draft);
    const incompleteClip = sequences[0]?.clips[0];
    if (!incompleteClip) throw new Error('Fixture clip missing.');
    incompleteClip.selectedMediaVersion.mediaAsset.variants[0].durationMs =
      null;
    const incomplete = {
      currentAssetId: incompleteClip.selectedMediaVersion.mediaAssetId,
    };
    const { service } = scopedService(draft, sequences);

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.runtime).not.toBeNull();
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'STORY_WORKING_PREVIEW_OUTPUT_METADATA_INCOMPLETE',
        entityId: incomplete.currentAssetId,
      }),
    );
  });

  it('keeps Preview playback for a browser-unsafe MP4 variant (browserSafeMp4 is informational)', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const sequences = previewSequences(draft);
    const unsafeClip = sequences[0]?.clips[0];
    if (!unsafeClip) throw new Error('Fixture clip missing.');
    unsafeClip.selectedMediaVersion.mediaAsset.variants[0].metadata = {
      browserSafeMp4: false,
    };
    const unsafe = {
      currentAssetId: unsafeClip.selectedMediaVersion.mediaAssetId,
    };
    const { service } = scopedService(draft, sequences);

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.videoSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    // A browser-unsafe MP4 that is otherwise technically complete must not
    // block the Preview manifest or raise an eligibility diagnostic.
    expect(preview.runtime).not.toBeNull();
    expect(preview.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'STORY_WORKING_PREVIEW_OUTPUT_METADATA_MISSING',
        entityId: unsafe.currentAssetId,
      }),
    );
  });

  it('reports an unavailable exact variant URL instead of throwing', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, assetUrls } = scopedService(draft);
    assetUrls.resolveVariant.mockImplementationOnce(() => {
      throw new Error('storage is not configured');
    });

    const preview = await service.getWorkingPreview(USER as never, PROJECT_ID);

    expect(preview.runtime).not.toBeNull();
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'STORY_WORKING_PREVIEW_OUTPUT_URL_UNAVAILABLE',
        severity: 'warning',
      }),
    );
  });

  it('ignores an old stored schema with a controlled diagnostic instead of parsing it', async () => {
    const draft = buildInteractiveFilmTestBundle().draftContent;
    const { service, tx } = scopedService(
      draft,
      [],
      'interactive-film-draft-v2',
    );

    await expect(
      service.getWorkingPreview(USER as never, PROJECT_ID),
    ).resolves.toMatchObject({
      runtime: null,
      videoSnapshotHash: null,
      pathReport: null,
      sources: [],
      diagnostics: [
        expect.objectContaining({
          code: 'STORY_WORKING_PREVIEW_DRAFT_SCHEMA_UNSUPPORTED',
        }),
      ],
    });
    expect(tx.storyStoryboardSequence.findMany).not.toHaveBeenCalled();
  });
});

describe('StoryWorkingPreviewController', () => {
  it('forwards the current project without a revision query', async () => {
    const preview = {
      draftRevision: 9,
      contentHash: 'a'.repeat(64),
      videoSnapshotHash: storyVideoSnapshotHash([]),
      runtimeSchemaVersion: 2 as const,
      runtime: null,
      diagnostics: [],
      pathReport: null,
      sources: [],
    };
    const service = { getWorkingPreview: jest.fn().mockResolvedValue(preview) };
    const controller = new StoryWorkingPreviewController(service as never);

    await expect(
      controller.getWorkingPreview(USER as never, {
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual({ code: 200, data: preview });
    expect(service.getWorkingPreview).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      undefined,
      undefined,
    );
  });

  it('forwards the chapter being edited so a preview starts there', () => {
    // Without this a multi-chapter work could only ever be previewed from its
    // very first scene, which is why the canvas entry used to be closed off.
    const service = { getWorkingPreview: jest.fn().mockResolvedValue(null) };
    const controller = new StoryWorkingPreviewController(service as never);
    const chapterId = uuidAt(9);

    void controller.getWorkingPreview(
      USER as never,
      { projectId: PROJECT_ID },
      { chapterId },
    );

    expect(service.getWorkingPreview).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      chapterId,
      undefined,
    );
  });

  it('forwards the scene whose play button was pressed', () => {
    const service = { getWorkingPreview: jest.fn().mockResolvedValue(null) };
    const controller = new StoryWorkingPreviewController(service as never);
    const chapterId = uuidAt(9);

    void controller.getWorkingPreview(
      USER as never,
      { projectId: PROJECT_ID },
      { chapterId, sceneId: 'clip:S01A' },
    );

    expect(service.getWorkingPreview).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      chapterId,
      'clip:S01A',
    );
  });
});

function uuidAt(value: number): string {
  return `01980f10-7a20-7c01-8000-${value.toString().padStart(12, '0')}`;
}
