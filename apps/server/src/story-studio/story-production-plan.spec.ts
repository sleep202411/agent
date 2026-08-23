import { BadRequestException } from '@nestjs/common';
import { MediaAssetKind } from '@prisma/client';
import {
  STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
  StoryProductionPlanSchema,
  type StoryProductionPlan,
} from '@repo/shared/story-production';
import {
  STORY_SCREENPLAY_SCHEMA_VERSION,
  StoryScreenplaySchema,
  type StoryScreenplay,
} from '@repo/shared/story-agent';
import { validateProductionPlanAgainstScreenplay } from './story-authoring-pipeline.service';
import { PutStoryStoryboardTimelineSchema } from './story-production-plan.schema';
import {
  assertStoryboardClipMediaKind,
  storyboardClipSemanticPatch,
  storyAssetSemanticPatch,
  StoryProductionPlanService,
} from './story-production-plan.service';

function screenplay(): StoryScreenplay {
  return StoryScreenplaySchema.parse({
    schemaVersion: STORY_SCREENPLAY_SCHEMA_VERSION,
    storyLanguage: 'en-US',
    title: 'The Gate',
    logline: 'A courier reaches a sealed city.',
    synopsis: 'One final choice decides who escapes.',
    characters: [
      {
        id: 'character.courier',
        name: { 'en-US': 'The Courier' },
        summary: 'A sworn imperial courier.',
      },
    ],
    entrySceneId: 'scene.gate',
    scenes: [
      {
        nodeId: 'scene.gate',
        clipKey: 'GATE',
        name: 'At the gate',
        heading: 'EXT. CITY GATE - NIGHT',
        beat: 'The courier chooses a route.',
        action: 'Snow seals the road behind the courier.',
        dialogue: [],
        exit: {
          kind: 'choice',
          decisionId: 'decision.route',
          prompt: { 'en-US': 'Which route?' },
          choices: [
            {
              choiceId: 'choice.wait',
              label: { 'en-US': 'Wait' },
              nextNodeId: 'scene.wait',
            },
            {
              choiceId: 'choice.run',
              label: { 'en-US': 'Run' },
              nextNodeId: 'scene.run',
            },
          ],
        },
      },
      {
        nodeId: 'scene.wait',
        clipKey: 'WAIT',
        heading: 'EXT. CITY GATE - DAWN',
        beat: 'The gate opens.',
        action: 'The courier waits until dawn.',
        dialogue: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
      {
        nodeId: 'scene.run',
        clipKey: 'RUN',
        heading: 'EXT. FROZEN MOAT - NIGHT',
        beat: 'The courier runs.',
        action: 'The courier crosses the frozen moat.',
        dialogue: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
    ],
  });
}

function plan(): StoryProductionPlan {
  const nodes = ['scene.gate', 'scene.wait', 'scene.run'];
  return StoryProductionPlanSchema.parse({
    schemaVersion: STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
    assetSpecs: [
      {
        stableKey: 'asset.character.courier',
        kind: 'character',
        name: 'The Courier',
        description: 'Imperial courier in a snow-dark cloak.',
        imagePrompt: 'Neutral full-body reference of the imperial courier.',
        sourceCharacterId: 'character.courier',
        sourceNodeIds: nodes,
      },
    ],
    storyboardSequences: nodes.map((plotNodeId) => ({
      plotNodeId,
      title: plotNodeId,
      description: `Footage of ${plotNodeId}.`,
      durationMs: 10_000,
      clips: [
        {
          stableKey: `shot.${plotNodeId}.main`,
          kind: 'video',
          title: plotNodeId,
          description: plotNodeId,
          startMs: 0,
          durationMs: 10_000,
          videoPrompt: `A cinematic rendering of ${plotNodeId} following @asset.character.courier.`,
        },
      ],
      cues:
        plotNodeId === 'scene.gate'
          ? [
              {
                stableKey: 'cue.scene.gate.route',
                kind: 'decision',
                atMs: 10_000,
                decisionId: 'decision.route',
              },
            ]
          : [],
    })),
  });
}

describe('validateProductionPlanAgainstScreenplay', () => {
  it('accepts one sequence per Plot node and a cue that only references Plot topology', () => {
    expect(
      validateProductionPlanAgainstScreenplay(plan(), screenplay()),
    ).toEqual([]);
  });

  it('rejects a mismatched decision cue without inventing a second graph', () => {
    const value = plan();
    value.storyboardSequences[0].cues[0].decisionId = 'decision.invented';
    expect(
      validateProductionPlanAgainstScreenplay(value, screenplay()).some(
        (issue) => issue.includes('exactly one cue'),
      ),
    ).toBe(true);
  });

  it('rejects cross-node asset lineage and missing canonical character specs', () => {
    const value = plan();
    value.assetSpecs[0].sourceNodeIds = ['scene.wait', 'scene.run'];
    value.assetSpecs[0].sourceCharacterId = 'character.unknown';
    const issues = validateProductionPlanAgainstScreenplay(value, screenplay());
    expect(issues.some((issue) => issue.includes('unknown character'))).toBe(
      true,
    );
    expect(
      issues.some((issue) => issue.includes('without chapter-node lineage')),
    ).toBe(true);
  });
});

describe('StoryProductionPlanService canonical Plot coverage', () => {
  const service = new StoryProductionPlanService(
    null as never,
    null as never,
    null as never,
  );

  function chapterDraft(source: StoryScreenplay) {
    return {
      storyBible: {
        logline: source.logline,
        synopsis: source.synopsis,
        characters: source.characters,
      },
      graph: {
        entryNodeId: source.entrySceneId,
        nodes: source.scenes.map((scene) => ({
          kind: 'clip' as const,
          nodeId: scene.nodeId,
          clipKey: scene.clipKey,
          description: `${scene.heading}\n\n${scene.action}`,
          interactions: [],
          exit: scene.exit,
        })),
      },
      productionNotes: [],
    };
  }

  it('rejects a plan that omits any chapter Plot node', () => {
    const source = screenplay();
    const incomplete = plan();
    incomplete.storyboardSequences.pop();
    expect(() =>
      service.validateApprovedProductionPlan({
        productionPlan: incomplete,
        canonicalCharacterIds: source.characters.map(
          (character) => character.id,
        ),
        chapterNodeIds: source.scenes.map((scene) => scene.nodeId),
        draft: chapterDraft(source),
      }),
    ).toThrow(/Missing: scene\.run/);
  });

  it('rejects incomplete coverage before the reconcile transaction can write any spec', async () => {
    const source = screenplay();
    const incomplete = plan();
    incomplete.storyboardSequences.pop();
    const assetCreate = jest.fn();
    const assetUpdate = jest.fn();
    const sequenceCreate = jest.fn();
    const sequenceUpdate = jest.fn();
    const tx = {
      storyChapter: {
        findFirst: jest.fn().mockResolvedValue({
          nodeIds: source.scenes.map((scene) => scene.nodeId),
        }),
      },
      storyDraft: {
        findUnique: jest.fn().mockResolvedValue({
          content: chapterDraft(source),
        }),
      },
      storyAssetSpec: {
        create: assetCreate,
        update: assetUpdate,
      },
      storyStoryboardSequence: {
        create: sequenceCreate,
        update: sequenceUpdate,
      },
    };

    await expect(
      service.applyApprovedProductionPlanInTransaction(tx as never, {
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        actorUserId: 'user-1',
        sourceFingerprint: 'a'.repeat(64),
        canonicalCharacterIds: source.characters.map(
          (character) => character.id,
        ),
        productionPlan: incomplete,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_PRODUCTION_STORYBOARD_INCOMPLETE',
      },
    });
    expect(assetCreate).not.toHaveBeenCalled();
    expect(assetUpdate).not.toHaveBeenCalled();
    expect(sequenceCreate).not.toHaveBeenCalled();
    expect(sequenceUpdate).not.toHaveBeenCalled();
  });
});

describe('PutStoryStoryboardTimelineSchema', () => {
  const imageClip = {
    expectedVersion: 0,
    stableKey: 'shot.gate.establishing',
    title: 'Establishing frame',
    kind: 'image' as const,
    startMs: 0,
    durationMs: 2_000,
    description: 'Snow closes around the city gate.',
    imagePrompt: 'A wide image of a city gate in falling snow.',
    videoPrompt: null,
    negativePrompt: null,
  };
  const videoClip = {
    expectedVersion: 0,
    stableKey: 'shot.gate.courier',
    title: 'Courier arrives',
    kind: 'video' as const,
    startMs: 2_000,
    durationMs: 8_000,
    description: 'The courier approaches the sealed gate.',
    imagePrompt: null,
    videoPrompt: 'Track the courier approaching the sealed gate.',
    negativePrompt: null,
  };

  it('accepts one complete ordered image/video visual track', () => {
    expect(
      PutStoryStoryboardTimelineSchema.parse({
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [imageClip, videoClip],
      }),
    ).toEqual({
      expectedVersion: 4,
      durationMs: 10_000,
      clips: [imageClip, videoClip],
    });
  });

  it.each([
    {
      name: 'gap',
      value: {
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [imageClip, { ...videoClip, startMs: 2_500, durationMs: 7_500 }],
      },
    },
    {
      name: 'overlap',
      value: {
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [imageClip, { ...videoClip, startMs: 1_500, durationMs: 8_500 }],
      },
    },
    {
      name: 'incomplete tail',
      value: {
        expectedVersion: 4,
        durationMs: 11_000,
        clips: [imageClip, videoClip],
      },
    },
    {
      name: 'nonzero version for a new clip',
      value: {
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [{ ...imageClip, expectedVersion: 2 }, videoClip],
      },
    },
    {
      name: 'duplicate stable key',
      value: {
        expectedVersion: 4,
        durationMs: 10_000,
        clips: [imageClip, { ...videoClip, stableKey: imageClip.stableKey }],
      },
    },
  ])('rejects a $name timeline', ({ value }) => {
    expect(PutStoryStoryboardTimelineSchema.safeParse(value).success).toBe(
      false,
    );
  });

  it('requires kind-correct prompts instead of coercing media semantics', () => {
    expect(
      PutStoryStoryboardTimelineSchema.safeParse({
        expectedVersion: 4,
        durationMs: 2_000,
        clips: [{ ...imageClip, videoPrompt: 'This must not be accepted.' }],
      }).success,
    ).toBe(false);
  });
});

describe('Story production semantic edit provenance', () => {
  it('does not classify media selection as a semantic Asset Spec edit', () => {
    expect(
      storyAssetSemanticPatch({
        expectedVersion: 2,
        selectedMediaVersionId: '0198f744-32a0-7000-8000-000000000001',
      }),
    ).toBe(false);
    expect(
      storyAssetSemanticPatch({
        expectedVersion: 2,
        imagePrompt: 'New prompt',
      }),
    ).toBe(true);
  });

  it('does not classify media selection as a semantic Storyboard clip edit', () => {
    expect(
      storyboardClipSemanticPatch({
        expectedVersion: 3,
        selectedMediaVersionId: '0198f744-32a0-7000-8000-000000000002',
      }),
    ).toBe(false);
    expect(
      storyboardClipSemanticPatch({
        expectedVersion: 3,
        videoPrompt: 'New movement',
      }),
    ).toBe(true);
  });
});

describe('Storyboard clip media selection', () => {
  it('accepts only a media asset whose kind matches the clip', () => {
    expect(() =>
      assertStoryboardClipMediaKind('image', MediaAssetKind.image),
    ).not.toThrow();
    try {
      assertStoryboardClipMediaKind('video', MediaAssetKind.image);
      throw new Error('Expected the mismatched media kind to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'STORYBOARD_CLIP_MEDIA_KIND_MISMATCH',
        message: 'A video Storyboard clip can only select video media.',
        clipKind: 'video',
        mediaKind: 'image',
      });
    }
  });
});
