import { StoryScreenplaySchema } from '@repo/shared/story-agent';
import {
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

  it('rejects missing per-scene Asset mentions inside the storyboard baton so that baton can retry', async () => {
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
    const repaired = StoryStoryboardSequencePlanItemSchema.parse({
      ...missingMention,
      clips: [
        {
          ...missingMention.clips[0],
          videoPrompt:
            'A courier enters @location.reverse-town beneath rising rain.',
        },
      ],
    });
    let batonIssues: string[] = [];
    mockedRunStoryAuthoringStage.mockImplementation((_model, call) => {
      batonIssues = call.validate?.(missingMention as never) ?? [];
      return Promise.resolve(repaired as never);
    });

    const result = await new StoryAuthoringPipelineService().planStoryboard({
      screenplay: SCREENPLAY,
      assetPlan,
      creativeProfile: CREATIVE_PROFILE,
      signal: new AbortController().signal,
    });

    expect(batonIssues).toContain(
      'Storyboard sequence for Plot node "opening" must @mention Asset Spec "location.reverse-town" because that Asset Spec declares this node in sourceNodeIds.',
    );
    expect(result.storyboardSequences).toEqual([repaired]);
  });
});
