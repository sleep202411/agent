import { StoryScreenplaySchema } from '@repo/shared/story-agent';
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
      creativeProfile: {
        frameProfile: 'portrait_9_16',
        durationPreset: 'short_5_15',
        visualStyle: 'anime-cinematic',
        visualStyleSkillId: 'story.visual-style.anime-cinematic',
        visualStyleSkillVersionId: 'story.visual-style.anime-cinematic@1',
        visualStylePrompt: 'Use cinematic anime staging.',
        storyLanguage: 'zh-CN',
        confirmedAt: '2026-08-25T00:00:00.000Z',
      },
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
});
