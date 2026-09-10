import { StoryScreenplaySchema } from '@repo/shared/story-agent';
import { storyBranchPlanSchemaForSkeleton } from '@repo/shared/story-authoring-pipeline';
import {
  normalizeStoryboardAssetMentions,
  StoryAssetPlanSchema,
  StoryStoryboardSequencePlanItemSchema,
} from '@repo/shared/story-production';
import {
  createStoryAuthoringModel,
  runStoryAuthoringStage,
} from './story-authoring-model';
import { StoryAuthoringPipelineService } from './story-authoring-pipeline.service';

jest.mock('./story-authoring-model', () => {
  const actual = jest.requireActual<typeof import('./story-authoring-model')>(
    './story-authoring-model',
  );
  return {
    ...actual,
    createStoryAuthoringModel: jest.fn(),
    runStoryAuthoringStage: jest.fn(),
  };
});

const mockedCreateStoryAuthoringModel = jest.mocked(createStoryAuthoringModel);
const mockedRunStoryAuthoringStage = jest.mocked(runStoryAuthoringStage);

const SCREENPLAY = StoryScreenplaySchema.parse({
  schemaVersion: 'interactive-screenplay-v1',
  storyLanguage: 'zh-CN',
  title: '逆流镇的信使',
  logline: '信使逆着时间送出一封信。',
  synopsis: '一名信使必须在倒流的城镇中完成最后一次投递。',
  characters: [],
  entrySceneId: 'opening',
  scenes: [
    {
      nodeId: 'opening',
      clipKey: 'OPENING',
      heading: '外景·逆流镇·黄昏',
      beat: '信使进入倒流的城镇。',
      action: '雨滴向天空升起。',
      dialogue: [],
      exit: { kind: 'auto', nextNodeId: null },
    },
  ],
});

const CREATIVE_PROFILE = {
  frameProfile: 'portrait_9_16',
  durationPreset: 'short_5_15',
  visualStyle: 'anime-cinematic',
  visualStyleSkillId: 'story.visual-style.anime-cinematic',
  visualStyleSkillVersionId: 'story.visual-style.anime-cinematic@1',
  visualStylePrompt: 'Use cinematic anime staging.',
  storyLanguage: 'zh-CN',
  confirmedAt: '2026-08-25T00:00:00.000Z',
} as const;

describe('StoryAuthoringPipelineService', () => {
  it('restricts branch targets to existing successors and makes endings terminal in the model schema', () => {
    const schema = storyBranchPlanSchemaForSkeleton({
      entryId: 'opening',
      nodes: [
        {
          id: 'opening',
          clipKey: 'OPENING',
          beat: 'Choose a path.',
          nextIds: ['ending'],
        },
        {
          id: 'ending',
          clipKey: 'ENDING',
          beat: 'The story ends.',
          nextIds: [],
        },
      ],
    });
    const valid = {
      branches: [
        { nodeId: 'opening', kind: 'auto', nextNodeId: 'ending' },
        { nodeId: 'ending', kind: 'auto', nextNodeId: null },
      ],
    };
    expect(schema.safeParse(valid).success).toBe(true);
    expect(
      schema.safeParse({
        branches: [
          { ...valid.branches[0], nextNodeId: 'opening' },
          valid.branches[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        branches: [
          valid.branches[0],
          { ...valid.branches[1], nextNodeId: 'opening' },
        ],
      }).success,
    ).toBe(false);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateStoryAuthoringModel.mockReturnValue({} as never);
    mockedRunStoryAuthoringStage.mockResolvedValue(SCREENPLAY);
  });

  it('gives full Script compilation a long deadline without widening small-stage timeouts', async () => {
    const service = new StoryAuthoringPipelineService();

    await service.compileScript({
      sourceText: '<screenplay><scene>雨滴向天空升起。</scene></screenplay>',
      title: '逆流镇的信使',
      creativeProfile: CREATIVE_PROFILE,
      signal: new AbortController().signal,
    });

    expect(mockedRunStoryAuthoringStage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stage: 'structure',
        maxOutputTokens: 32_768,
        timeoutMs: 15 * 60_000,
      }),
    );
  });

  it('treats sourceNodeIds as hints and keeps a sequence without asset mentions', async () => {
    const assetPlan = StoryAssetPlanSchema.parse({
      assetSpecs: [
        {
          stableKey: 'location.reverse-town',
          kind: 'location',
          name: '逆流镇',
          description: '雨水倒流的城镇街道。',
          imagePrompt: 'Cinematic anime reference of the reverse-flowing town.',
          sourceNodeIds: ['opening'],
        },
      ],
    });
    const missingMention = StoryStoryboardSequencePlanItemSchema.parse({
      plotNodeId: 'opening',
      title: '进入逆流镇',
      description: '信使进入城镇。',
      durationMs: 2_000,
      clips: [
        {
          stableKey: 'shot.opening.main',
          kind: 'video',
          title: '信使抵达',
          description: '信使走进街道。',
          startMs: 0,
          durationMs: 2_000,
          videoPrompt: 'A courier enters a town beneath rising rain.',
        },
      ],
      cues: [],
    });
    let batonIssues: string[] = [];
    mockedRunStoryAuthoringStage.mockImplementation((_model, call) => {
      batonIssues = call.validate?.(missingMention as never) ?? [];
      return Promise.resolve(missingMention as never);
    });

    const result = await new StoryAuthoringPipelineService().planStoryboard({
      screenplay: SCREENPLAY,
      assetPlan,
      creativeProfile: CREATIVE_PROFILE,
      signal: new AbortController().signal,
    });

    expect(batonIssues).toEqual([]);
    expect(result.storyboardSequences).toEqual([missingMention]);
  });

  it('repairs unambiguous model aliases and removes unknown @ identity', () => {
    const sequence = StoryStoryboardSequencePlanItemSchema.parse({
      plotNodeId: 'opening',
      title: '进入逆流镇',
      description: '信使进入城镇。',
      durationMs: 2_000,
      clips: [
        {
          stableKey: 'shot.opening.main',
          kind: 'video',
          title: '信使抵达',
          description: '信使走进街道。',
          startMs: 0,
          durationMs: 2_000,
          videoPrompt:
            '@character_LinYu enters @location.reverse-town beside @invented_extra.',
        },
      ],
      cues: [],
    });
    const assets = StoryAssetPlanSchema.parse({
      assetSpecs: [
        {
          stableKey: 'LinYu',
          kind: 'character',
          name: '林雨',
          description: '信使。',
          imagePrompt: 'Character reference.',
          sourceCharacterId: 'LinYu',
          sourceNodeIds: ['opening'],
        },
        {
          stableKey: 'location.reverse-town',
          kind: 'location',
          name: '逆流镇',
          description: '雨水倒流的城镇街道。',
          imagePrompt: 'Location reference.',
          sourceNodeIds: [],
        },
      ],
    }).assetSpecs;

    expect(
      normalizeStoryboardAssetMentions(sequence, assets).clips[0],
    ).toMatchObject({
      videoPrompt:
        '@LinYu enters @location.reverse-town beside invented_extra.',
    });
  });
});
