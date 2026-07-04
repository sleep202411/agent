import { ACT_KEYS, GENRE_TEMPLATES, STORY_GENRE_KEYS } from './act-templates';
import { coerceAnalysisV2, validateAnalysisSemantics } from './analysis-schema';
import { StoryGenerationService } from './story-generation.service';

const OWNER = { userId: 'user-1' };

/** A structurally valid raw model payload. */
function validRawAnalysis(): Record<string, unknown> {
  return {
    title: '雨夜钥匙',
    summary: '一把钥匙牵出十年悬案。',
    worldview: '香港茶餐厅。',
    storyKernel: '钥匙与失踪案。',
    adaptationDirection: '悬疑',
    genre: 'suspense',
    locations: ['茶餐厅'],
    acts: ACT_KEYS.map((key, index) => ({
      key,
      anchor: `幕${index + 1}锚点`,
      emotionArc: '不安',
      exitHook: '钩子',
    })),
    protagonist: { name: '阿敏', role: '主角', summary: '老板娘。' },
    characters: [
      { name: '陈伯', role: '常客', summary: '寡言。', tags: ['角色'] },
    ],
    clues: [
      {
        title: '黄铜钥匙',
        summary: '不属于任何门。',
        type: 'physical',
        source: '收档时发现',
        use: '开启储物间',
        rule: '需先获得信任',
        tags: ['线索'],
      },
    ],
    plots: ACT_KEYS.map((key, index) => ({
      title: `节点${index + 1}`,
      summary: '一个可玩阶段。',
      entryGoal: '了解处境。',
      actKey: key,
      tags: ['自由行动'],
    })),
    endings: [
      {
        title: '真相大白',
        type: 'truth',
        summary: '闭环。',
        trigger: '集齐证据',
        review: '复盘证据链',
        tags: ['结局'],
      },
    ],
    guardrails: ['不提前揭露真凶'],
  };
}

describe('act templates (fizzstory PPT slide 7)', () => {
  it('covers all 10 genres with all 4 acts', () => {
    expect(STORY_GENRE_KEYS).toHaveLength(10);
    for (const key of STORY_GENRE_KEYS) {
      const template = GENRE_TEMPLATES[key];
      for (const actKey of ACT_KEYS) {
        expect(template.acts[actKey].anchor.length).toBeGreaterThan(0);
        expect(template.acts[actKey].exitHook.length).toBeGreaterThan(0);
        expect(template.emotionKeywords[actKey].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('analysis v2 validation', () => {
  it('accepts a structurally valid analysis', () => {
    const analysis = coerceAnalysisV2(validRawAnalysis(), 'fallback');
    expect(validateAnalysisSemantics(analysis)).toEqual([]);
    expect(analysis.genre).toBe('suspense');
    expect(analysis.acts).toHaveLength(4);
  });

  it('flags a missing act and an orphan act', () => {
    const raw = validRawAnalysis();
    raw.acts = (raw.acts as unknown[]).slice(0, 3); // drop 合
    raw.plots = (raw.plots as Array<Record<string, unknown>>).map((plot) => ({
      ...plot,
      actKey: 'setup', // every beat crammed into 起
    }));
    const analysis = coerceAnalysisV2(raw, 'fallback');
    const errors = validateAnalysisSemantics(analysis);
    expect(errors.join('\n')).toContain('"resolution"');
    expect(errors.join('\n')).toContain('actKey "development"');
  });

  it('coerces unknown genre/actKey drift instead of crashing', () => {
    const raw = validRawAnalysis();
    raw.genre = 'space-opera';
    (raw.plots as Array<Record<string, unknown>>)[0].actKey = '第一幕';
    const analysis = coerceAnalysisV2(raw, 'fallback');
    expect(analysis.genre).toBe('suspense');
    expect(analysis.plots[0].actKey).toBe('setup');
  });
});

describe('StoryGenerationService.generateAnalysis', () => {
  function makeService(llmResponses: Array<Record<string, unknown>>) {
    const completeJson = jest.fn(async () => {
      const json = llmResponses.shift();
      if (!json) throw new Error('unexpected extra llm call');
      return {
        json,
        model: 'qwen-plus',
        requestId: `req-${llmResponses.length}`,
      };
    });
    const tx = {
      storyDraft: {
        findUnique: jest.fn(async () => ({
          content: {
            schemaVersion: 'story-studio-canvas-v2',
            canvas: { nodes: [], edges: [] },
          },
          revision: 1,
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      storyProject: {
        update: jest.fn(async () => ({
          updatedAt: new Date('2026-07-03T02:00:00Z'),
        })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const projects = {
      requireOwnProject: jest.fn(async () => ({ id: 'proj-1' })),
    };
    const service = new StoryGenerationService(
      prisma as never,
      projects as never,
      { completeJson } as never,
    );
    return { service, completeJson, tx };
  }

  it('persists a valid analysis into the draft (schema v2, storySpec, revision+1)', async () => {
    const { service, completeJson, tx } = makeService([validRawAnalysis()]);
    const result = await service.executeAnalysis(OWNER as never, 'proj-1', {
      prompt: '茶餐厅钥匙',
      locale: 'zh-CN',
    });
    expect(completeJson).toHaveBeenCalledTimes(1);
    expect(result.analysis.acts).toHaveLength(4);
    expect(result.draft.revision).toBe(2);
    const write = (tx.storyDraft.updateMany as jest.Mock).mock.calls[0][0];
    expect(write.data.schemaVersion).toBe('story-studio-canvas-v2');
    const content = write.data.content as Record<string, unknown>;
    expect(content.schemaVersion).toBe('story-studio-canvas-v2');
    expect((content.storySpec as Record<string, unknown>).genre).toBe(
      'suspense',
    );
  });

  it('repairs once when the first payload is structurally invalid', async () => {
    const broken = validRawAnalysis();
    broken.acts = [];
    const { service, completeJson } = makeService([broken, validRawAnalysis()]);
    const result = await service.executeAnalysis(OWNER as never, 'proj-1', {
      prompt: 'x',
      locale: 'en-US',
    });
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(result.analysis.acts).toHaveLength(4);
  });

  it('marks the pipeline running and rejects a duplicate fresh start', async () => {
    const { service, tx } = makeService([]);
    const started = await service.startAnalysis(OWNER as never, 'proj-1', {
      prompt: 'x',
      locale: 'en-US',
    });
    expect(started.pipeline.status).toBe('running');
    const write = (tx.storyDraft.updateMany as jest.Mock).mock.calls[0][0];
    const spec = (write.data.content as Record<string, unknown>)
      .storySpec as Record<string, unknown>;
    expect((spec.pipeline as Record<string, unknown>).status).toBe('running');

    // Second start while the fresh marker is in place → 409.
    (tx.storyDraft.findUnique as jest.Mock).mockImplementationOnce(
      async () => ({
        content: {
          storySpec: {
            pipeline: {
              stage: 'analysis',
              status: 'running',
              startedAt: new Date().toISOString(),
            },
          },
        },
        revision: 2,
      }),
    );
    await expect(
      service.startAnalysis(OWNER as never, 'proj-1', {
        prompt: 'x',
        locale: 'en-US',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'GENERATION_IN_PROGRESS' }),
    });
  });

  it('fails 422 with the violation list when repair also fails', async () => {
    const broken = validRawAnalysis();
    broken.acts = [];
    const stillBroken = validRawAnalysis();
    stillBroken.acts = [];
    const { service } = makeService([broken, stillBroken]);
    await expect(
      service.executeAnalysis(OWNER as never, 'proj-1', {
        prompt: 'x',
        locale: 'en-US',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_ANALYSIS_INVALID' }),
    });
  });
});
