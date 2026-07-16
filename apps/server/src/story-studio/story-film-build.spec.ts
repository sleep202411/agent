import { ConflictException, GoneException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MediaAssetModerationStatus,
  MediaAssetVariantStatus,
  StoryFilmContinuityDecision,
  StoryFilmDependencyKind,
} from '@prisma/client';
import {
  STORY_CHECKPOINT_CONTINUE_ACTION_ID,
  STORY_CHECKPOINT_RENDERER_ID,
} from '@repo/shared/interactive-film-runtime';
import {
  FilmSpecSchema,
  type FilmCondition,
  type InteractiveFilmDraftContent,
} from './interactive-film.schema';
import {
  applyFilmEffect,
  compileStoryFilmBuild,
  evaluateFilmCondition,
  type StoryFilmBuildClipInput,
} from './story-film-build-compiler';
import { StoryFilmBuildController } from './story-film-build.controller';
import {
  storyBuildAssetDeliveryPath,
  storyFilmBuildContinuityDiagnostics,
  storyFilmBuildInputManifest,
  storyBuildModerationDiagnostics,
  storyBuildRequestFingerprint,
  StoryFilmBuildService,
} from './story-film-build.service';
import { buildHuBaoVillaImportBundle } from './import/hu-bao-villa.builder';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const REVISION_ID = '0197f4a2-0800-7000-8000-000000000003';
const BUILD_ID = '0197f4a2-0800-7000-8000-000000000004';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000005';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000006';
const USER = { userId: 'user-1' };

function uuid(index: number, group = '1000'): string {
  return `0197f4a2-${group}-7000-8000-${index.toString(16).padStart(12, '0')}`;
}

function fixture() {
  const bundle = buildHuBaoVillaImportBundle();
  const clips: StoryFilmBuildClipInput[] = bundle.clipSpecs.map(
    (spec, index) => ({
      id: uuid(index + 1, '2000'),
      key: spec.key,
      graphNodeId: spec.graphNodeId,
      rank: spec.rank,
      specHash: `${(index + 1).toString(16).padStart(64, '0')}`,
      productionInputHash: `${(index + 101).toString(16).padStart(64, '0')}`,
      spec,
      sourceGenerationId: uuid(index + 1, '3000'),
      asset: {
        assetId: uuid(index + 1, '4000'),
        variantId: uuid(index + 1, '5000'),
        checksumSha256: `${(index + 201).toString(16).padStart(64, '0')}`,
        contentType: 'video/mp4',
        sizeBytes: 1000n,
        width: 1920,
        height: 1080,
        durationMs: 15_000,
        url: `https://cdn.example.test/${spec.key}.mp4`,
      },
      eligibilityDiagnostics: [],
    }),
  );
  return { bundle, clips };
}

function compileFixture(
  overrides: {
    draft?: InteractiveFilmDraftContent;
    clips?: StoryFilmBuildClipInput[];
    filmSpec?: ReturnType<typeof FilmSpecSchema.parse>;
  } = {},
) {
  const { bundle, clips } = fixture();
  return compileStoryFilmBuild({
    projectId: PROJECT_ID,
    revisionId: REVISION_ID,
    revisionNumber: 1,
    buildId: BUILD_ID,
    profile: 'production',
    scope: { kind: 'full' },
    draft: overrides.draft ?? bundle.draftContent,
    filmSpec: overrides.filmSpec ?? bundle.filmSpec,
    clips: overrides.clips ?? clips,
  });
}

describe('Story film Build compiler', () => {
  it('compiles the complete 21-clip graph into the shared runtime contract', () => {
    const { bundle, clips } = fixture();
    const result = compileFixture({
      draft: bundle.draftContent,
      filmSpec: bundle.filmSpec,
      clips,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.runtime).not.toBeNull();
    expect(result.runtime?.media).toHaveLength(21);
    expect(
      result.runtime?.nodes.some(
        (node) => 'kind' in node && node.kind === 'router',
      ),
    ).toBe(true);
    expect(result.runtime?.initialState.variables).toMatchObject({
      truth: 0,
      bond: 0,
      echo: 0,
    });
    expect(result.runtime?.endings).toHaveLength(4);
    expect(
      result.runtime?.endings.every((ending) => ending.summary?.['zh-CN']),
    ).toBe(true);
    expect(result.runtime?.endings[0]?.summary).toEqual(
      bundle.draftContent.storyBible.endings[0]?.summary,
    );
    expect(
      result.runtime?.nodes.flatMap((node) =>
        node.exit.kind === 'external-overlay' &&
        node.exit.rendererId === STORY_CHECKPOINT_RENDERER_ID
          ? [node.exit]
          : [],
      ),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: 'external-overlay',
          rendererId: STORY_CHECKPOINT_RENDERER_ID,
          routes: [
            {
              actionId: STORY_CHECKPOINT_CONTINUE_ACTION_ID,
              effects: [],
              nextNodeId: 'clip:E01',
            },
          ],
        },
      ]),
    );
    expect(
      result.runtime?.nodes.filter(
        (node) =>
          node.exit.kind === 'external-overlay' &&
          node.exit.rendererId === STORY_CHECKPOINT_RENDERER_ID,
      ),
    ).toHaveLength(4);
    expect(result.pathReport).toMatchObject({
      enumeratedPathCount: 64,
      reachableEndingIds: ['E01', 'E02', 'E03', 'E04'],
      ambiguousPathCount: 0,
      durationMinMs: 120_000,
      durationMaxMs: 120_000,
    });
  });

  it('counts distinct decision ids and includes reaction playback in path duration', () => {
    const { bundle } = fixture();
    const draft = structuredClone(bundle.draftContent);
    const firstChoiceNode = draft.graph.nodes.find(
      (node) => node.exit.kind === 'choice',
    );
    if (!firstChoiceNode || firstChoiceNode.exit.kind !== 'choice') {
      throw new Error('Fixture choice node missing.');
    }
    firstChoiceNode.exit.choices[0].afterSelect = {
      kind: 'play',
      reactionClipKey: 'E01',
    };
    const filmSpec = FilmSpecSchema.parse({
      ...bundle.filmSpec,
      duration: {
        ...bundle.filmSpec.duration,
        targetMs: 127_500,
        toleranceMs: 7_500,
        maxContinuousMs: 30_000,
      },
    });
    const result = compileFixture({ draft, filmSpec });

    expect(result.diagnostics).toEqual([]);
    expect(result.pathReport.enumeratedPathCount).toBe(64);
    expect(result.pathReport.durationMinMs).toBe(120_000);
    expect(result.pathReport.durationMaxMs).toBe(135_000);
    const runtimeChoice = result.runtime?.nodes.find(
      (node) => node.exit.kind === 'choice' && node.exit.decisionId === 'C1',
    );
    expect(runtimeChoice?.exit.kind).toBe('choice');
    if (runtimeChoice?.exit.kind === 'choice') {
      expect(runtimeChoice.exit.choices[0]?.afterSelect).toEqual({
        kind: 'play',
        reactionAssetId: 'video:E01',
      });
    }
  });

  it('reports frozen current-video Variant durations instead of authored targets', () => {
    const { bundle, clips } = fixture();
    const first = clips[0];
    if (!first?.asset || !first.spec) {
      throw new Error('Fixture Clip asset missing.');
    }
    first.asset = { ...first.asset, durationMs: 14_000 };
    first.spec = {
      ...first.spec,
      outputContract: {
        ...first.spec.outputContract,
        durationToleranceMs: 1_000,
      },
    };
    const filmSpec = FilmSpecSchema.parse({
      ...bundle.filmSpec,
      duration: {
        ...bundle.filmSpec.duration,
        targetMs: 119_500,
        toleranceMs: 500,
      },
    });

    const result = compileFixture({ clips, filmSpec });

    expect(result.diagnostics).toEqual([]);
    expect(result.pathReport.durationMinMs).toBe(119_000);
    expect(result.pathReport.durationMaxMs).toBe(119_000);
    expect(result.runtime?.media[0]).toMatchObject({
      variants: {
        landscape: { durationSeconds: 14 },
      },
    });
  });

  it('fails when an actual path duration falls outside the Film contract tolerance', () => {
    const { clips } = fixture();
    const first = clips[0];
    if (!first?.asset) throw new Error('Fixture Clip asset missing.');
    first.asset = { ...first.asset, durationMs: 14_000 };

    const result = compileFixture({ clips });

    expect(result.runtime).toBeNull();
    expect(result.pathReport.durationMinMs).toBe(119_000);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_PATH_DURATION_OUT_OF_RANGE',
        }),
      ]),
    );
  });

  it('fails an uninterrupted auto-play segment beyond maxContinuousMs', () => {
    const { bundle } = fixture();
    const draft = structuredClone(bundle.draftContent);
    const entry = draft.graph.nodes.find(
      (node) => node.nodeId === draft.graph.entryNodeId,
    );
    if (!entry || entry.exit.kind !== 'choice') {
      throw new Error('Fixture entry decision missing.');
    }
    const successorId = entry.exit.choices[0]?.nextNodeId;
    if (!successorId) throw new Error('Fixture successor missing.');
    entry.exit = {
      kind: 'auto',
      nextNodeId: successorId,
    };

    const filmSpec = FilmSpecSchema.parse({
      ...bundle.filmSpec,
      duration: {
        ...bundle.filmSpec.duration,
        maxContinuousMs: 15_000,
      },
      targets: { ...bundle.filmSpec.targets, choiceCount: 5 },
    });
    const result = compileFixture({ draft, filmSpec });

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_CONTINUOUS_DURATION_EXCEEDED',
        }),
      ]),
    );
  });

  it('resets uninterrupted playback at a checkpoint without changing path duration', () => {
    const { bundle } = fixture();
    const draft = structuredClone(bundle.draftContent);
    const checkpoint = draft.graph.nodes.find(
      (node) => node.exit.kind === 'checkpoint',
    );
    if (!checkpoint || checkpoint.exit.kind !== 'checkpoint') {
      throw new Error('Fixture checkpoint missing.');
    }
    const nextNodeId = checkpoint.exit.nextNodeId;
    checkpoint.exit = {
      kind: 'auto',
      nextNodeId,
    };

    const result = compileFixture({ draft });

    expect(result.pathReport.durationMinMs).toBe(120_000);
    expect(result.pathReport.durationMaxMs).toBe(120_000);
    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_CONTINUOUS_DURATION_EXCEEDED',
          entityId: nextNodeId,
        }),
      ]),
    );
  });

  it('includes checkpoint continuations in structural cycle detection', () => {
    const { bundle } = fixture();
    const draft = structuredClone(bundle.draftContent);
    const checkpoint = draft.graph.nodes.find(
      (node) => node.exit.kind === 'checkpoint',
    );
    if (!checkpoint || checkpoint.exit.kind !== 'checkpoint') {
      throw new Error('Fixture checkpoint missing.');
    }
    checkpoint.exit.nextNodeId = checkpoint.nodeId;

    const result = compileFixture({ draft });

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_GRAPH_CYCLE',
          entityId: checkpoint.nodeId,
        }),
      ]),
    );
  });

  it('counts a reaction and its auto-started successor in one uninterrupted segment', () => {
    const { bundle } = fixture();
    const draft = structuredClone(bundle.draftContent);
    const decision = draft.graph.nodes.find(
      (node) => node.exit.kind === 'choice',
    );
    if (!decision || decision.exit.kind !== 'choice') {
      throw new Error('Fixture decision missing.');
    }
    decision.exit.choices[0].afterSelect = {
      kind: 'play',
      reactionClipKey: 'E01',
    };
    const filmSpec = FilmSpecSchema.parse({
      ...bundle.filmSpec,
      duration: {
        ...bundle.filmSpec.duration,
        targetMs: 127_500,
        toleranceMs: 7_500,
        maxContinuousMs: 29_000,
      },
    });

    const result = compileFixture({ draft, filmSpec });

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_CONTINUOUS_DURATION_EXCEEDED',
        }),
      ]),
    );
  });

  it('fails an incomplete current-video snapshot instead of fabricating media', () => {
    const { clips } = fixture();
    clips[0] = {
      ...clips[0],
      sourceGenerationId: null,
      asset: null,
      eligibilityDiagnostics: [
        {
          severity: 'error',
          code: 'STORY_BUILD_CURRENT_VIDEO_MISSING',
          message: 'Current video missing.',
          entityType: 'clip',
          entityId: clips[0].id,
        },
      ],
    };
    const result = compileFixture({ clips });

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'STORY_BUILD_CURRENT_VIDEO_MISSING' }),
      ]),
    );
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_PATH_DURATION_OUT_OF_RANGE',
        }),
      ]),
    );
  });

  it('rejects separate audio instead of silently changing the authored output contract', () => {
    const { clips } = fixture();
    const first = clips[0];
    if (!first?.spec) throw new Error('Fixture Clip specification missing.');
    first.spec = {
      ...first.spec,
      outputContract: { ...first.spec.outputContract, audio: 'separate' },
    };

    const result = compileFixture({ clips });

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_SEPARATE_AUDIO_UNSUPPORTED',
          entityId: first.id,
        }),
      ]),
    );
  });

  it('reports a corrupt selected Clip specification without dereferencing it', () => {
    const { clips } = fixture();
    const first = clips[0];
    if (!first) throw new Error('Fixture Clip missing.');
    first.spec = null;
    first.eligibilityDiagnostics = [
      {
        severity: 'error',
        code: 'STORY_BUILD_CLIP_SPEC_CORRUPT',
        message: 'Clip specification is corrupt.',
        entityType: 'clip',
        entityId: first.id,
      },
    ];

    expect(() => compileFixture({ clips })).not.toThrow();
    const result = compileFixture({ clips });
    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'STORY_BUILD_CLIP_SPEC_CORRUPT' }),
      ]),
    );
  });

  it('diagnoses every reachable auto-route ambiguity and all unreachable authored endings', () => {
    const { bundle } = fixture();
    const draft = structuredClone(bundle.draftContent);
    const auto = draft.graph.nodes.find(
      (node) => node.kind === 'router' && node.exit.routes.length > 0,
    );
    if (!auto || auto.kind !== 'router') {
      throw new Error('Fixture auto node missing.');
    }
    auto.exit.routes.push({ ...auto.exit.routes[0], priority: 999 });
    draft.storyBible.endings.push({
      id: 'E05',
      title: {
        'en-US': 'Unreachable ending',
        'zh-CN': '不可达结局',
        'zh-HK': '不可達結局',
      },
      summary: {
        'en-US': 'This ending is intentionally unreachable in the test.',
        'zh-CN': '这个测试结局被刻意设为不可达。',
        'zh-HK': '這個測試結局被刻意設為不可達。',
      },
      kind: 'hidden',
    });
    const filmSpec = FilmSpecSchema.parse({
      ...bundle.filmSpec,
      targets: { ...bundle.filmSpec.targets, endingCount: 5 },
    });
    const result = compileFixture({ draft, filmSpec });

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_AUTO_ROUTE_AMBIGUOUS_STATE',
        }),
        expect.objectContaining({
          code: 'STORY_BUILD_ENDING_UNREACHABLE',
          entityId: 'E05',
        }),
      ]),
    );
    expect(result.pathReport.ambiguousPathCount).toBeGreaterThan(0);
  });

  it('bounds explored branch states even when an exponential graph has no completed paths', () => {
    const { bundle } = fixture();
    const draft = structuredClone(bundle.draftContent);
    const templateNode = draft.graph.nodes.find(
      (node) => node.kind === 'clip' && node.exit.kind === 'choice',
    );
    if (!templateNode || templateNode.exit.kind !== 'choice') {
      throw new Error('Fixture decision template missing.');
    }
    const templateExit = templateNode.exit;
    const baseChoice = templateExit.choices[0];
    if (!baseChoice) throw new Error('Fixture choice template missing.');
    const nodes = draft.graph.nodes
      .filter((node) => node.kind === 'clip')
      .slice(0, 8);
    if (nodes.length !== 8) throw new Error('Fixture Clip nodes missing.');
    nodes.slice(0, -1).forEach((node, index) => {
      const nextNode = nodes[index + 1];
      if (!nextNode) throw new Error('Adversarial successor missing.');
      node.exit = {
        ...templateExit,
        decisionId: `BRANCH_${index + 1}`,
        choices: Array.from({ length: 6 }, (_, optionIndex) => ({
          ...baseChoice,
          choiceId: `BRANCH_${index + 1}_${optionIndex + 1}`,
          label: { 'zh-CN': `分支 ${optionIndex + 1}` },
          effects: [],
          nextNodeId: nextNode.nodeId,
          afterSelect: { kind: 'immediate' as const },
        })),
      };
    });
    const terminal = nodes.at(-1);
    if (!terminal) throw new Error('Adversarial terminal missing.');
    terminal.exit = { kind: 'auto', nextNodeId: null };
    draft.graph = { entryNodeId: nodes[0]?.nodeId ?? null, nodes };
    const filmSpec = FilmSpecSchema.parse({
      ...bundle.filmSpec,
      targets: {
        ...bundle.filmSpec.targets,
        clipCount: nodes.length,
        choiceCount: nodes.length - 1,
      },
    });

    const result = compileFixture({ draft, filmSpec });

    expect(result.pathReport.enumeratedPathCount).toBe(0);
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'STORY_BUILD_PATH_LIMIT_EXCEEDED',
      ),
    ).toHaveLength(1);
  });

  it.each([
    ['equals', 2, 2, true],
    ['not_equals', 2, 3, true],
    ['greater_than', 3, 2, true],
    ['at_least', 2, 2, true],
    ['less_than', 1, 2, true],
    ['at_most', 2, 2, true],
  ] as const)(
    'evaluates the %s variable operator',
    (operator, actual, expected, result) => {
      const condition: FilmCondition = {
        kind: 'variable',
        key: 'score',
        operator,
        value: expected,
      };
      expect(
        evaluateFilmCondition(condition, {
          variables: { score: actual },
          flags: {},
          relationships: {},
        }),
      ).toBe(result);
    },
  );

  it('applies every authored state effect used by route enumeration', () => {
    const state = {
      variables: { score: 1 },
      flags: {} as Record<string, boolean>,
      relationships: {} as Record<string, number>,
      unlockedEndings: new Set<string>(),
    };

    applyFilmEffect(
      { kind: 'set_variable', key: 'mood', value: 'brave' },
      state,
    );
    applyFilmEffect(
      { kind: 'increment_variable', key: 'score', amount: 2 },
      state,
    );
    applyFilmEffect(
      { kind: 'set_flag', flag: 'door_open', value: true },
      state,
    );
    applyFilmEffect(
      { kind: 'adjust_relationship', characterId: 'C01', amount: 3 },
      state,
    );
    applyFilmEffect({ kind: 'unlock_ending', endingId: 'E01' }, state);

    expect(state.variables).toEqual({ score: 3, mood: 'brave' });
    expect(state.flags).toEqual({ door_open: true });
    expect(state.relationships).toEqual({ C01: 3 });
    expect(state.unlockedEndings).toEqual(new Set(['E01']));
  });

  it('fails a reachable path when cumulative effects exceed a declared state range', () => {
    const { bundle } = fixture();
    const draft = structuredClone(bundle.draftContent);
    const truth = draft.storyBible.stateVariables.find(
      (variable) => variable.key === 'truth' && variable.type === 'number',
    );
    if (!truth || truth.type !== 'number') {
      throw new Error('Fixture truth variable missing.');
    }
    truth.maximum = 0;

    const result = compileFixture({ draft });

    expect(result.runtime).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_STATE_VARIABLE_CONTRACT_VIOLATION',
          entityType: 'choice',
        }),
      ]),
    );
  });
});

describe('StoryFilmBuildController', () => {
  it('forwards revision, CAS, workspace, and Idempotency-Key to Build creation', async () => {
    const build = { id: BUILD_ID, status: 'failed' };
    const service = { createBuild: jest.fn().mockResolvedValue(build) };
    const controller = new StoryFilmBuildController(service as never);
    const body = {
      revisionId: REVISION_ID,
      expectedProductionRevision: 3,
      profile: 'preview' as const,
      scope: { kind: 'full' as const },
    };

    await expect(
      controller.createBuild(
        USER as never,
        WORKSPACE_ID,
        'build-request-1',
        { projectId: PROJECT_ID },
        body,
      ),
    ).resolves.toEqual({ code: 200, data: build });
    expect(service.createBuild).toHaveBeenCalledWith(
      USER,
      WORKSPACE_ID,
      PROJECT_ID,
      body,
      'build-request-1',
    );
  });

  it('redirects an authenticated Build asset request without requiring a workspace header', async () => {
    const service = {
      issueBuildAssetReadUrl: jest.fn().mockResolvedValue({
        url: 'https://signed.example.test/video.mp4?expires=300',
        expiresAt: '2026-07-13T12:05:00.000Z',
      }),
    };
    const response = {
      setHeader: jest.fn(),
      redirect: jest.fn().mockReturnValue('redirected'),
    };
    const controller = new StoryFilmBuildController(service as never);

    await expect(
      controller.redirectToBuildAsset(
        USER as never,
        {
          projectId: PROJECT_ID,
          buildId: BUILD_ID,
          assetId: ASSET_ID,
          variantId: VARIANT_ID,
        },
        response as never,
      ),
    ).resolves.toBe('redirected');
    expect(service.issueBuildAssetReadUrl).toHaveBeenCalledWith(
      USER,
      PROJECT_ID,
      BUILD_ID,
      ASSET_ID,
      VARIANT_ID,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'cache-control',
      'private, no-store',
    );
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://signed.example.test/video.mp4?expires=300',
    );
  });
});

describe('StoryFilmBuildService idempotency', () => {
  it('replays the same semantic request and rejects key reuse with another payload', async () => {
    const input = {
      revisionId: REVISION_ID,
      expectedProductionRevision: 0,
      profile: 'preview' as const,
      scope: { kind: 'full' as const },
    };
    const row = {
      id: BUILD_ID,
      requestFingerprint: storyBuildRequestFingerprint(input),
      status: 'failed',
    };
    const prisma = {
      storyBuild: { findUnique: jest.fn().mockResolvedValue(row) },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: WORKSPACE_ID },
      }),
    };
    const service = new StoryFilmBuildService(
      prisma as never,
      permissions as never,
      {} as never,
    );
    jest.spyOn(service as never, 'toBuildDto').mockReturnValue(row as never);

    await expect(
      service.createBuild(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        input,
        'same-key',
      ),
    ).resolves.toEqual(row);
    prisma.storyBuild.findUnique.mockResolvedValue({
      ...row,
      requestFingerprint: '0'.repeat(64),
    });
    await expect(
      service.createBuild(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        input,
        'same-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('StoryFilmBuildService direct current-video compilation', () => {
  const CHECKSUM = 'a'.repeat(64);
  const SPEC_HASH = 'b'.repeat(64);
  const GENERATION_ID = uuid(1, '7000');

  function currentVideoClip() {
    const { bundle } = fixture();
    const spec = bundle.clipSpecs[0];
    if (!spec) throw new Error('Fixture Clip specification missing.');
    return {
      id: uuid(2, '7000'),
      storyProjectId: PROJECT_ID,
      revisionId: REVISION_ID,
      key: spec.key,
      graphNodeId: spec.graphNodeId,
      title: spec.title,
      generationMode: spec.generationControl.mode,
      frameMode:
        spec.generationControl.mode === 'frame_lock'
          ? spec.generationControl.frameMode
          : null,
      targetDurationMs: spec.outputContract.durationMs,
      specJson: spec,
      specHash: SPEC_HASH,
      productionInputManifest: null,
      productionInputHash: null,
      version: 0,
      rank: spec.rank,
      currentVideoAssetId: ASSET_ID,
      currentVideoVariantId: VARIANT_ID,
      currentVideoSourceAttemptId: null,
      currentVideoSpecHash: SPEC_HASH,
      currentVideoInputHash: null,
      currentVideoChecksumSha256: CHECKSUM,
      currentVideoTechnicalChecks: [
        { key: 'kind', status: 'passed', message: null },
        { key: 'dimensions', status: 'passed', message: null },
        { key: 'duration', status: 'passed', message: null },
        { key: 'checksum', status: 'passed', message: null },
      ],
      currentVideoRevision: 4,
      currentVideoSetByUserId: USER.userId,
      currentVideoSetAt: new Date('2026-07-15T12:00:00.000Z'),
      latestGenerationAttemptId: null,
      createdByUserId: USER.userId,
      updatedByUserId: USER.userId,
      archivedAt: null,
      createdAt: new Date('2026-07-15T11:00:00.000Z'),
      updatedAt: new Date('2026-07-15T12:00:00.000Z'),
      currentVideoAsset: {
        id: ASSET_ID,
        workspaceId: WORKSPACE_ID,
        kind: 'video',
        storageProvider: 'aliyun_oss',
        bucket: 'story-media',
        region: 'oss-cn-hangzhou',
        objectKey: 'clips/current-video.mp4',
        externalUrl: null,
        contentType: 'video/mp4',
        sizeBytes: 1_024n,
        width: spec.outputContract.width,
        height: spec.outputContract.height,
        durationSeconds: spec.outputContract.durationMs / 1_000,
        checksumSha256: CHECKSUM,
        visibility: 'private',
        status: 'ready',
        source: 'generated',
        moderationStatus: 'approved',
        moderationReason: null,
        moderatedByAdminId: null,
        moderatedAt: null,
        metadata: {},
        createdByUserId: USER.userId,
        createdAt: new Date('2026-07-15T11:55:00.000Z'),
        updatedAt: new Date('2026-07-15T11:55:00.000Z'),
        deletedAt: null,
        placements: [],
      },
      currentVideoVariant: {
        id: VARIANT_ID,
        assetId: ASSET_ID,
        variantKey: 'original',
        kind: 'original',
        status: 'ready',
        contentType: 'video/mp4',
        sizeBytes: 1_024n,
        width: spec.outputContract.width,
        height: spec.outputContract.height,
        durationSeconds: spec.outputContract.durationMs / 1_000,
        checksumSha256: CHECKSUM,
        metadata: {},
        createdAt: new Date('2026-07-15T11:55:00.000Z'),
        updatedAt: new Date('2026-07-15T11:55:00.000Z'),
        deletedAt: null,
        placements: [],
      },
    };
  }

  function prepareClip(row: ReturnType<typeof currentVideoClip>) {
    const service = new StoryFilmBuildService(
      {} as never,
      {} as never,
      {} as never,
    );
    return (
      service as unknown as {
        prepareClip(
          build: {
            id: string;
            storyProjectId: string;
            project: { workspaceId: string };
          },
          clip: ReturnType<typeof currentVideoClip>,
        ): StoryFilmBuildClipInput;
      }
    ).prepareClip(
      {
        id: BUILD_ID,
        storyProjectId: PROJECT_ID,
        project: { workspaceId: WORKSPACE_ID },
      },
      row,
    );
  }

  it('builds a selected library asset without generation provenance or production input hashes', () => {
    const row = currentVideoClip();
    // Asset-level metadata and the selected Variant can describe different
    // bytes. Current-video identity is always the selected Variant checksum,
    // never an asset-level fallback.
    row.currentVideoAsset.checksumSha256 = '0'.repeat(64);
    const prepared = prepareClip(row);

    expect(prepared.eligibilityDiagnostics).toEqual([]);
    expect(prepared.sourceGenerationId).toBeNull();
    expect(prepared.productionInputHash).toBeNull();
    expect(prepared.asset).toMatchObject({
      assetId: ASSET_ID,
      variantId: VARIANT_ID,
      checksumSha256: CHECKSUM,
    });
  });

  it.each([
    ['spec hash', { currentVideoSpecHash: 'c'.repeat(64) }],
    [
      'input hash',
      {
        productionInputHash: 'd'.repeat(64),
        currentVideoInputHash: null,
      },
    ],
  ])('rejects an outdated current video by %s', (_label, changes) => {
    const row = Object.assign(currentVideoClip(), changes);
    expect(prepareClip(row).eligibilityDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'STORY_BUILD_CURRENT_VIDEO_OUTDATED' }),
      ]),
    );
  });

  it('rejects pending, failed, empty, or malformed technical checks', () => {
    const rows = [
      [{ key: 'duration', status: 'pending', message: null }],
      [{ key: 'duration', status: 'failed', message: 'Too long.' }],
      [{ key: 'duration', status: 'passed', message: null }],
      [],
      [{ status: 'passed' }],
    ];

    rows.forEach((currentVideoTechnicalChecks) => {
      const row = currentVideoClip();
      row.currentVideoTechnicalChecks = currentVideoTechnicalChecks;
      expect(prepareClip(row).eligibilityDiagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'STORY_BUILD_CURRENT_VIDEO_TECHNICAL_CHECKS_FAILED',
          }),
        ]),
      );
    });
  });

  it('strictly rejects a foreign Workspace and non-signable storage', () => {
    const row = currentVideoClip();
    row.currentVideoAsset.workspaceId = uuid(3, '7000');
    row.currentVideoAsset.storageProvider = 'external_url';
    row.currentVideoAsset.bucket = null;
    row.currentVideoAsset.objectKey = null;
    row.currentVideoAsset.externalUrl =
      'https://cdn.example.test/current-video.mp4';

    expect(prepareClip(row).eligibilityDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'STORY_BUILD_ASSET_SCOPE_INVALID' }),
        expect.objectContaining({ code: 'STORY_BUILD_ASSET_NOT_SIGNABLE' }),
      ]),
    );
  });

  it('freezes currentVideoRevision and direct media identity in manifest v2', () => {
    const row = currentVideoClip();
    row.currentVideoSourceAttemptId = GENERATION_ID;
    const manifest = storyFilmBuildInputManifest(
      {
        revisionId: REVISION_ID,
        expectedProductionRevision: 3,
        profile: 'production',
        scope: { kind: 'full' },
      },
      {
        revision: {
          id: REVISION_ID,
          number: 2,
          content: {},
          contentHash: 'e'.repeat(64),
        },
        filmSpec: {
          specJson: {},
          specHash: 'f'.repeat(64),
          productionRevision: 3,
        },
        clips: [row],
        dependencies: [],
      } as never,
    );

    expect(manifest).toMatchObject({
      schemaVersion: 2,
      clips: [
        {
          currentVideo: {
            revision: 4,
            assetId: ASSET_ID,
            variantId: VARIANT_ID,
            sourceGenerationAttemptId: GENERATION_ID,
            checksumSha256: CHECKSUM,
            asset: { id: ASSET_ID },
            variant: { id: VARIANT_ID },
          },
        },
      ],
    });
    expect(JSON.stringify(manifest)).not.toMatch(/take|master/i);
  });

  it('matches continuity by both direct assets, variants, and checksums', () => {
    const upstream = prepareClip(currentVideoClip());
    const downstreamRow = currentVideoClip();
    downstreamRow.id = uuid(4, '7000');
    downstreamRow.currentVideoAssetId = uuid(5, '7000');
    downstreamRow.currentVideoVariantId = uuid(6, '7000');
    downstreamRow.currentVideoChecksumSha256 = '9'.repeat(64);
    downstreamRow.currentVideoAsset.id = downstreamRow.currentVideoAssetId;
    downstreamRow.currentVideoAsset.checksumSha256 =
      downstreamRow.currentVideoChecksumSha256;
    downstreamRow.currentVideoVariant.id = downstreamRow.currentVideoVariantId;
    downstreamRow.currentVideoVariant.assetId =
      downstreamRow.currentVideoAssetId;
    downstreamRow.currentVideoVariant.checksumSha256 =
      downstreamRow.currentVideoChecksumSha256;
    const downstream = prepareClip(downstreamRow);
    const dependency = {
      id: uuid(7, '7000'),
      kind: StoryFilmDependencyKind.continuity,
      predecessorClipId: upstream.id,
      successorClipId: downstream.id,
      continuityChecks: [
        {
          id: uuid(8, '7000'),
          upstreamAssetId: upstream.asset?.assetId,
          upstreamVariantId: upstream.asset?.variantId,
          upstreamChecksumSha256: upstream.asset?.checksumSha256,
          downstreamAssetId: downstream.asset?.assetId,
          downstreamVariantId: downstream.asset?.variantId,
          downstreamChecksumSha256: downstream.asset?.checksumSha256,
          decision: StoryFilmContinuityDecision.pass,
        },
      ],
    };

    expect(
      storyFilmBuildContinuityDiagnostics(
        [dependency] as never,
        [upstream, downstream],
        new Set([upstream.id, downstream.id]),
      ),
    ).toEqual([]);

    dependency.continuityChecks[0].downstreamChecksumSha256 = '8'.repeat(64);
    expect(
      storyFilmBuildContinuityDiagnostics(
        [dependency] as never,
        [upstream, downstream],
        new Set([upstream.id, downstream.id]),
      ),
    ).toEqual([
      expect.objectContaining({ code: 'STORY_BUILD_CONTINUITY_CHECK_MISSING' }),
    ]);
  });
});

describe('StoryFilmBuildService media delivery policy', () => {
  const CHECKSUM = 'a'.repeat(64);

  function readyBuildRow(
    moderationStatus: MediaAssetModerationStatus = MediaAssetModerationStatus.approved,
  ) {
    return {
      id: BUILD_ID,
      storyProjectId: PROJECT_ID,
      sourceRevisionId: REVISION_ID,
      buildNumber: 1,
      submissionKey: 'submission',
      requestFingerprint: 'b'.repeat(64),
      kind: 'preview',
      scope: { kind: 'full' },
      sourceProductionRevision: 2,
      status: 'ready',
      inputHash: 'c'.repeat(64),
      inputManifestHash: 'd'.repeat(64),
      runtimeSchemaVersion: 1,
      runtimeJson: {
        media: [
          {
            variants: {
              landscape: {
                src: storyBuildAssetDeliveryPath(
                  PROJECT_ID,
                  BUILD_ID,
                  ASSET_ID,
                  VARIANT_ID,
                ),
              },
            },
          },
        ],
      },
      runtimeHash: 'e'.repeat(64),
      diagnostics: [],
      pathReport: {
        enumeratedPathCount: 1,
        reachableEndingIds: ['E01'],
        unreachableNodeIds: [],
        ambiguousPathCount: 0,
        durationMinMs: 15_000,
        durationMaxMs: 15_000,
      },
      errorCode: null,
      errorDetail: null,
      version: 3,
      createdByUserId: USER.userId,
      startedAt: new Date('2026-07-13T12:00:00.000Z'),
      completedAt: new Date('2026-07-13T12:01:00.000Z'),
      createdAt: new Date('2026-07-13T12:00:00.000Z'),
      updatedAt: new Date('2026-07-13T12:01:00.000Z'),
      project: { workspaceId: WORKSPACE_ID },
      assets: [
        {
          id: uuid(7, '6000'),
          buildId: BUILD_ID,
          storyProjectId: PROJECT_ID,
          logicalKey: 'clip:S01:video',
          role: 'video',
          assetId: ASSET_ID,
          variantId: VARIANT_ID,
          checksumSha256: CHECKSUM,
          contentType: 'video/mp4',
          sizeBytes: 1_024n,
          width: 1920,
          height: 1080,
          durationMs: 15_000,
          rank: 0,
          createdAt: new Date('2026-07-13T12:00:00.000Z'),
          filmClip: { clipId: uuid(8, '6000') },
          asset: {
            id: ASSET_ID,
            status: 'ready',
            moderationStatus,
            checksumSha256: CHECKSUM,
            deletedAt: null,
          },
          variant: {
            id: VARIANT_ID,
            assetId: ASSET_ID,
            status: 'ready',
            checksumSha256: CHECKSUM,
            deletedAt: null,
          },
        },
      ],
    };
  }

  it('applies approval-required moderation to shared Build compilation', () => {
    expect(
      storyBuildModerationDiagnostics(
        {
          id: ASSET_ID,
          moderationStatus: MediaAssetModerationStatus.unreviewed,
        },
        { status: MediaAssetVariantStatus.ready },
        true,
        'Current video',
      ),
    ).toEqual([
      expect.objectContaining({
        code: 'STORY_BUILD_ASSET_MODERATION_PENDING',
        entityId: ASSET_ID,
      }),
    ]);
    expect(
      storyBuildModerationDiagnostics(
        {
          id: ASSET_ID,
          moderationStatus: MediaAssetModerationStatus.unreviewed,
        },
        { status: MediaAssetVariantStatus.ready },
        false,
        'Current video',
      ),
    ).toEqual([]);
  });

  it('keeps a frozen runtime available when only the asset-level checksum differs', async () => {
    const row = readyBuildRow();
    row.assets[0].asset.checksumSha256 = '0'.repeat(64);
    const service = new StoryFilmBuildService(
      {
        storyBuild: { findFirst: jest.fn().mockResolvedValue(row) },
      } as never,
      {
        requireProject: jest.fn().mockResolvedValue({
          project: { workspaceId: WORKSPACE_ID },
        }),
      } as never,
      {} as never,
    );

    const detail = await service.getBuild(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      BUILD_ID,
    );

    expect(detail.runtimeJson).not.toBeNull();
    expect(detail.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_ASSET_INTEGRITY_CHANGED',
        }),
      ]),
    );
  });

  it('suppresses a ready runtime and annotates list/get when current moderation no longer permits playback', async () => {
    const previous = process.env.MEDIA_REQUIRE_MODERATION_APPROVAL;
    process.env.MEDIA_REQUIRE_MODERATION_APPROVAL = 'true';
    try {
      const row = readyBuildRow(MediaAssetModerationStatus.unreviewed);
      const prisma = {
        storyBuild: {
          findFirst: jest.fn().mockResolvedValue(row),
          findMany: jest.fn().mockResolvedValue([row]),
        },
      };
      const permissions = {
        requireProject: jest.fn().mockResolvedValue({
          project: { workspaceId: WORKSPACE_ID },
        }),
      };
      const service = new StoryFilmBuildService(
        prisma as never,
        permissions as never,
        {} as never,
      );

      const detail = await service.getBuild(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        BUILD_ID,
      );
      const list = await service.listBuilds(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        { limit: 20 },
      );

      expect(detail.status).toBe('ready');
      expect(detail.runtimeJson).toBeNull();
      expect(detail.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'STORY_BUILD_ASSET_MODERATION_PENDING',
          }),
        ]),
      );
      expect(list.items[0]?.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'STORY_BUILD_ASSET_MODERATION_PENDING',
          }),
        ]),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.MEDIA_REQUIRE_MODERATION_APPROVAL;
      } else {
        process.env.MEDIA_REQUIRE_MODERATION_APPROVAL = previous;
      }
    }
  });

  it('withholds legacy runtimes that contain permanent object URLs', async () => {
    const row = readyBuildRow();
    row.runtimeJson.media[0].variants.landscape.src =
      'https://cdn.example.test/permanent-current-video.mp4';
    const prisma = {
      storyBuild: { findFirst: jest.fn().mockResolvedValue(row) },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: WORKSPACE_ID },
      }),
    };
    const service = new StoryFilmBuildService(
      prisma as never,
      permissions as never,
      {} as never,
    );

    const detail = await service.getBuild(
      USER as never,
      WORKSPACE_ID,
      PROJECT_ID,
      BUILD_ID,
    );

    expect(detail.runtimeJson).toBeNull();
    expect(detail.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'STORY_BUILD_RUNTIME_DELIVERY_UNSAFE',
        }),
      ]),
    );
  });

  it('authorizes Build membership and signs the exact frozen variant on every delivery request', async () => {
    const row = readyBuildRow();
    const frozen = {
      ...row.assets[0],
      build: { status: 'ready' },
      asset: {
        ...row.assets[0].asset,
        visibility: 'private',
        storageProvider: 'aliyun_oss',
        bucket: 'story-media',
        region: 'oss-cn-hangzhou',
        objectKey: 'builds/current-video.mp4',
        externalUrl: null,
        contentType: 'video/mp4',
        placements: [],
      },
      variant: {
        ...row.assets[0].variant,
        variantKey: 'original',
        contentType: 'video/mp4',
        placements: [],
      },
    };
    const prisma = {
      storyBuildAsset: { findFirst: jest.fn().mockResolvedValue(frozen) },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: WORKSPACE_ID },
      }),
    };
    const storage = {
      createReadUrl: jest.fn().mockResolvedValue({
        url: 'https://signed.example.test/current-video.mp4?expires=300',
        expiresAt: '2026-07-13T12:05:00.000Z',
      }),
    };
    const service = new StoryFilmBuildService(
      prisma as never,
      permissions as never,
      storage as never,
    );

    await expect(
      service.issueBuildAssetReadUrl(
        USER as never,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).resolves.toEqual({
      url: 'https://signed.example.test/current-video.mp4?expires=300',
      expiresAt: '2026-07-13T12:05:00.000Z',
    });
    expect(permissions.requireProject).toHaveBeenCalledWith(
      USER.userId,
      PROJECT_ID,
      'story.read',
    );
    expect(prisma.storyBuildAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storyProjectId: PROJECT_ID,
          buildId: BUILD_ID,
          assetId: ASSET_ID,
          variantId: VARIANT_ID,
        },
      }),
    );
    expect(storage.createReadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        storageProvider: 'aliyun_oss',
        bucket: 'story-media',
        objectKey: 'builds/current-video.mp4',
      }),
      expect.objectContaining({
        cacheControl: 'private, no-store',
        expiresInSeconds: 300,
      }),
    );
  });

  it('rejects external Build media because it cannot provide expiring signed access', async () => {
    const row = readyBuildRow();
    const frozen = {
      ...row.assets[0],
      build: { status: 'ready' },
      asset: {
        ...row.assets[0].asset,
        visibility: 'public',
        storageProvider: 'external_url',
        bucket: null,
        region: null,
        objectKey: null,
        externalUrl: 'https://cdn.example.test/permanent-current-video.mp4',
        contentType: 'video/mp4',
        placements: [],
      },
      variant: {
        ...row.assets[0].variant,
        variantKey: 'original',
        contentType: 'video/mp4',
        placements: [],
      },
    };
    const prisma = {
      storyBuildAsset: { findFirst: jest.fn().mockResolvedValue(frozen) },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: WORKSPACE_ID },
      }),
    };
    const storage = { createReadUrl: jest.fn() };
    const service = new StoryFilmBuildService(
      prisma as never,
      permissions as never,
      storage as never,
    );

    await expect(
      service.issueBuildAssetReadUrl(
        USER as never,
        PROJECT_ID,
        BUILD_ID,
        ASSET_ID,
        VARIANT_ID,
      ),
    ).rejects.toBeInstanceOf(GoneException);
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
});

describe('Story Build database duration guard', () => {
  it('validates frozen actual duration against the immutable output tolerance', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20260713200000_story_build_duration_guard/migration.sql',
      ),
      'utf8',
    );

    expect(sql).toContain("'{outputContract,durationMs}'");
    expect(sql).toContain("'{outputContract,durationToleranceMs}'");
    expect(sql).toContain('a."duration_ms" IS DISTINCT FROM bc."duration_ms"');
    expect(sql).not.toContain('bc."duration_ms" <> c."target_duration_ms"');
  });
});
