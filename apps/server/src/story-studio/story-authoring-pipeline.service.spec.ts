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
import {
  documentFromStorySource,
  SOURCE_PARTITION_SYSTEM,
  SOURCE_BATCH_SYSTEM,
  SOURCE_BOUNDARY_SYSTEM,
  SOURCE_ROUTING_REPAIR_SYSTEM,
  type StorySourcePartition,
} from './story-source-extraction';

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

function scopedAudit(prompt: string) {
  const scope = JSON.parse(
    prompt.split('<audit_scope>')[1].split('</audit_scope>')[0],
  ) as {
    requiredRoutes: Array<{ nodeId: string; targetNodeId: string | null }>;
  };
  return {
    routes: scope.requiredRoutes.map((route) => ({
      ...route,
      source: { start: 0, end: 0 },
      assessment: 'Source continuation.',
      correct: true,
    })),
    issues: [],
  };
}

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

const SOURCE_PARTITION: StorySourcePartition = {
  title: '逆流镇的信使',
  logline: '雨滴倒流。',
  synopsis: '雨滴升起。',
  characters: [],
  additionalStarts: [],
};
const SOURCE_BATCH = {
  source_0: {
    name: '雨滴',
    heading: '镇外',
    beat: '雨滴升起',
    exit: { kind: 'auto', nextNodeId: null },
    unsupportedRules: [],
  },
};

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

  it('repairs disconnected routes against the complete graph without regenerating source segments', async () => {
    const source = '开场\n共同对白\n后续对白\n结尾';
    mockedRunStoryAuthoringStage.mockImplementation(async (_model, call) => {
      await Promise.resolve();
      if (call.system === SOURCE_PARTITION_SYSTEM)
        return { ...SOURCE_PARTITION, additionalStarts: [0, 1, 2, 3] } as never;
      if (call.system === SOURCE_ROUTING_REPAIR_SYSTEM) {
        expect(call.prompt).toContain('<complete_graph>');
        expect(call.prompt).toContain('source_1 at block 1 is unreachable');
        const repair = {
          patches: [
            {
              nodeId: 'source_0',
              exit: { kind: 'auto', nextNodeId: 'source_1' },
              unsupportedRules: [],
            },
          ],
        };
        expect(call.validate?.(repair as never)?.join('\n')).toContain(
          'source_2 at block 2 is unreachable',
        );
        const current = JSON.parse(
          call.refreshPrompt!()
            .split('<complete_graph>')[1]
            .split('</complete_graph>')[0],
        ) as { scenes: { nodeId: string; exit: { nextNodeId: string } }[] };
        expect(
          current.scenes.find((s) => s.nodeId === 'source_0')?.exit.nextNodeId,
        ).toBe('source_1');
        const regression = {
          patches: [
            {
              ...repair.patches[0],
              exit: { kind: 'auto', nextNodeId: 'source_3' },
            },
          ],
        };
        expect(call.validate?.(regression as never)?.join('\n')).toContain(
          'increases validation failures',
        );
        const preserved = JSON.parse(
          call.refreshPrompt!()
            .split('<complete_graph>')[1]
            .split('</complete_graph>')[0],
        ) as typeof current;
        expect(
          preserved.scenes.find((s) => s.nodeId === 'source_0')?.exit
            .nextNodeId,
        ).toBe('source_1');
        const second = {
          patches: [
            {
              nodeId: 'source_1',
              exit: { kind: 'auto', nextNodeId: 'source_2' },
              unsupportedRules: [],
            },
          ],
        };
        expect(call.validate?.(second as never)).toEqual([]);
        return second as never;
      }
      if (call.stage === 'validate') return scopedAudit(call.prompt) as never;
      // The entry's choice makes source_1 a declared alternative, so the
      // deterministic linear spine must leave both orphans to the model loop.
      return Object.fromEntries(
        [0, 1, 2, 3].map((i) => [
          `source_${i}`,
          {
            ...SOURCE_BATCH.source_0,
            exit:
              i === 0
                ? {
                    kind: 'choice',
                    prompt: '选择去向',
                    choices: [
                      {
                        source: { start: 0, end: 0 },
                        label: '开场',
                        nextNodeId: 'source_3',
                      },
                    ],
                  }
                : { kind: 'auto', nextNodeId: i === 3 ? null : 'source_3' },
          },
        ]),
      ) as never;
    });
    const result = await new StoryAuthoringPipelineService().compileScript({
      sourceText: source,
      document: documentFromStorySource(source),
      title: '原稿',
      creativeProfile: CREATIVE_PROFILE,
      signal: new AbortController().signal,
    });
    expect(result.screenplay.scenes.map((s) => s.action)).toEqual([
      '开场',
      '共同对白',
      '后续对白',
      '结尾',
    ]);
    expect(result.screenplay.scenes[0].exit).toEqual({
      kind: 'auto',
      nextNodeId: 'source_1',
    });
    expect(mockedRunStoryAuthoringStage).toHaveBeenCalledTimes(4);
  });

  it('chains plain orphaned scenes along reading order before the model repair loop', async () => {
    const source = '开场\n共同对白\n后续对白\n结尾';
    const batchPrompts: string[] = [];
    const partitionPrompts: string[] = [];
    mockedRunStoryAuthoringStage.mockImplementation(async (_model, call) => {
      await Promise.resolve();
      if (call.system === SOURCE_PARTITION_SYSTEM) {
        partitionPrompts.push(call.prompt);
        return { ...SOURCE_PARTITION, additionalStarts: [0, 1, 2, 3] } as never;
      }
      if (call.system === SOURCE_BATCH_SYSTEM) batchPrompts.push(call.prompt);
      if (call.system === SOURCE_ROUTING_REPAIR_SYSTEM)
        throw new Error('The spine must prevent this repair call.');
      if (call.stage === 'validate') return scopedAudit(call.prompt) as never;
      return Object.fromEntries(
        [0, 1, 2, 3].map((i) => [
          `source_${i}`,
          {
            ...SOURCE_BATCH.source_0,
            exit: { kind: 'auto', nextNodeId: i === 3 ? null : 'source_3' },
          },
        ]),
      ) as never;
    });
    const result = await new StoryAuthoringPipelineService().compileScript({
      sourceText: source,
      document: documentFromStorySource(source),
      title: '原稿',
      creativeProfile: CREATIVE_PROFILE,
      signal: new AbortController().signal,
    });
    // The batch stage orphaned source_1/source_2 (everything jumped to
    // source_3); the deterministic spine restores the reading-order spine
    // 0→1→2→3 without spending a model repair round.
    expect(result.screenplay.scenes.map((scene) => scene.exit)).toEqual([
      { kind: 'auto', nextNodeId: 'source_1' },
      { kind: 'auto', nextNodeId: 'source_2' },
      { kind: 'auto', nextNodeId: 'source_3' },
      { kind: 'auto', nextNodeId: null },
    ]);
    // Concurrent batch wiring works from the catalog plus its assigned
    // passages only; the full <source_blocks> payload stays with the global
    // (serial, rare) partition call.
    expect(batchPrompts.length).toBeGreaterThan(0);
    for (const prompt of batchPrompts) {
      expect(prompt).toContain('<scene_catalog>');
      expect(prompt).toContain('<assigned_passages>');
      expect(prompt).not.toContain('<source_blocks>');
    }
    expect(partitionPrompts.length).toBeGreaterThan(0);
    for (const prompt of partitionPrompts)
      expect(prompt).toContain('<source_blocks>');
  });

  it('reviews every unassigned paragraph before freezing the catalog for wiring', async () => {
    const source = '开场\n选择A回应\n选择B回应\n共有对白\n共有对白继续';
    const seen: string[] = [];
    mockedRunStoryAuthoringStage.mockImplementation(async (_model, call) => {
      await Promise.resolve();
      seen.push(call.system);
      if (call.system === SOURCE_PARTITION_SYSTEM)
        return { ...SOURCE_PARTITION, additionalStarts: [1, 2] } as never;
      if (call.system === SOURCE_BOUNDARY_SYSTEM) {
        expect(call.prompt).toContain('Requested ids: [3,4]');
        expect(call.prompt).toContain('共有对白');
        return { block_3: 'branch_rejoin', block_4: 'continuation' } as never;
      }
      if (call.stage === 'validate') return scopedAudit(call.prompt) as never;
      const segments = JSON.parse(
        call.prompt.split('Assigned immutable segments: ')[1].split('\n')[0],
      ) as { nodeId: string; start: number }[];
      expect(segments.map((s) => s.start)).toEqual([0, 1, 2, 3]);
      return Object.fromEntries(
        segments.map((s, index) => [
          s.nodeId,
          {
            ...SOURCE_BATCH.source_0,
            exit: {
              kind: 'auto',
              nextNodeId: segments[index + 1]?.nodeId ?? null,
            },
          },
        ]),
      ) as never;
    });
    const result = await new StoryAuthoringPipelineService().compileScript({
      sourceText: source,
      document: documentFromStorySource(source),
      title: '原稿',
      creativeProfile: CREATIVE_PROFILE,
      signal: new AbortController().signal,
    });
    expect(result.screenplay.scenes.at(-1)?.action).toBe(
      '共有对白\n\n共有对白继续',
    );
    expect(seen[1]).toBe(SOURCE_BOUNDARY_SYSTEM);
  });

  it('bounds partition and scene batches separately from the full fidelity audit', async () => {
    const service = new StoryAuthoringPipelineService();
    mockedRunStoryAuthoringStage
      .mockResolvedValueOnce(SOURCE_PARTITION as never)
      .mockResolvedValueOnce(SOURCE_BATCH as never)
      .mockResolvedValueOnce({
        routes: [
          {
            nodeId: 'source_0',
            targetNodeId: null,
            source: { start: 0, end: 0 },
            assessment: 'End of source.',
            correct: true,
          },
        ],
        issues: [],
      } as never);

    const result = await service.compileScript({
      sourceText: '<screenplay><scene>雨滴向天空升起。</scene></screenplay>',
      document: documentFromStorySource('雨滴向天空升起。'),
      title: '逆流镇的信使',
      creativeProfile: CREATIVE_PROFILE,
      signal: new AbortController().signal,
    });

    expect(mockedRunStoryAuthoringStage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stage: 'structure',
        maxOutputTokens: 4096,
        timeoutMs: 120_000,
      }),
    );
    expect(result.screenplay.scenes[0].action).toBe('雨滴向天空升起。');
    expect(result.document?.blocks[0].text).toBe('雨滴向天空升起。');
    expect(
      mockedRunStoryAuthoringStage.mock.calls.map(([, call]) => call.stage),
    ).toEqual(['structure', 'structure', 'validate']);
  });

  it('plans at most four batches concurrently against fixed source identities', async () => {
    const lines = Array.from({ length: 33 }, (_, i) => `原文段落${i}`);
    let active = 0,
      peak = 0;
    const sizes: number[] = [];
    mockedRunStoryAuthoringStage.mockImplementation(async (_model, call) => {
      if (call.system === SOURCE_PARTITION_SYSTEM)
        return {
          ...SOURCE_PARTITION,
          additionalStarts: lines.map((_, i) => i),
        } as never;
      if (call.stage === 'validate') return scopedAudit(call.prompt) as never;
      const batch = JSON.parse(
        call.prompt.split('Assigned immutable segments: ')[1].split('\n')[0],
      ) as { nodeId: string; start: number }[];
      sizes.push(batch.length);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      return Object.fromEntries(
        batch.map((s) => [
          s.nodeId,
          {
            name: '段落',
            heading: '段落',
            beat: '段落',
            exit: {
              kind: 'auto',
              nextNodeId: s.start === 32 ? null : `source_${s.start + 1}`,
            },
            unsupportedRules: [],
          },
        ]),
      ) as never;
    });
    const result = await new StoryAuthoringPipelineService().compileScript({
      sourceText: lines.join('\n'),
      document: documentFromStorySource(lines.join('\n')),
      title: '原稿',
      creativeProfile: CREATIVE_PROFILE,
      signal: new AbortController().signal,
    });
    expect(peak).toBe(4);
    expect(sizes).toEqual([8, 8, 8, 8, 1]);
    expect(result.screenplay.scenes.map((s) => s.nodeId)).toEqual(
      lines.map((_, i) => `source_${i}`),
    );
    expect(result.screenplay.scenes.map((s) => s.action)).toEqual(lines);
  });

  it('aborts and drains sibling batches when one batch fails', async () => {
    const lines = Array.from({ length: 33 }, (_, i) => `原文段落${i}`);
    let calls = 0,
      aborted = 0;
    const controller = new AbortController();
    mockedRunStoryAuthoringStage.mockImplementation(async (_model, call) => {
      if (call.system === SOURCE_PARTITION_SYSTEM)
        return {
          ...SOURCE_PARTITION,
          additionalStarts: lines.map((_, i) => i),
        } as never;
      calls++;
      if (calls === 1) throw new Error('batch failed');
      return await new Promise<never>((_resolve, reject) => {
        call.signal.addEventListener(
          'abort',
          () => {
            aborted++;
            reject(new Error('sibling aborted'));
          },
          { once: true },
        );
      });
    });
    await expect(
      new StoryAuthoringPipelineService().compileScript({
        sourceText: lines.join('\n'),
        document: documentFromStorySource(lines.join('\n')),
        title: '原稿',
        creativeProfile: CREATIVE_PROFILE,
        signal: controller.signal,
      }),
    ).rejects.toThrow('batch failed');
    expect(calls).toBe(4);
    expect(aborted).toBe(3);
    expect(controller.signal.aborted).toBe(false);
  });

  it('preserves an uploaded complete screenplay by default and never invokes the scene writer', async () => {
    mockedRunStoryAuthoringStage
      .mockResolvedValueOnce(SOURCE_PARTITION as never)
      .mockResolvedValueOnce(SOURCE_BATCH as never)
      .mockResolvedValueOnce({
        routes: [
          {
            nodeId: 'source_0',
            targetNodeId: null,
            source: { start: 0, end: 0 },
            assessment: 'End of source.',
            correct: true,
          },
        ],
        issues: [],
      } as never);
    const result = await new StoryAuthoringPipelineService().author({
      job: {
        document: { text: '雨滴向天空升起。' },
        brief: { title: '原稿', brief: '修正遗漏的共同对白，保持原文。' },
        creativeProfile: CREATIVE_PROFILE,
      } as never,
      signal: new AbortController().signal,
    });
    expect(result.screenplay.sourceMode).toBe('preserved');
    expect(mockedRunStoryAuthoringStage.mock.calls[0][1].prompt).toContain(
      '修正遗漏的共同对白，保持原文。',
    );
    expect(result.screenplay.scenes[0].action).toBe('雨滴向天空升起。');
    expect(
      mockedRunStoryAuthoringStage.mock.calls.map(([, call]) => call.stage),
    ).toEqual(['structure', 'structure', 'validate']);
  });

  it('uses the creative author only when adaptation is explicitly requested', async () => {
    mockedRunStoryAuthoringStage.mockRejectedValueOnce(
      new Error('foundation reached'),
    );
    await expect(
      new StoryAuthoringPipelineService().author({
        job: {
          document: { name: 'Outline', text: '雨滴向天空升起。' },
          contextJson: {},
          brief: {
            title: '改编',
            summary: '展开梗概',
            brief: '展开梗概',
            sourceMode: 'adapt',
          },
          creativeProfile: CREATIVE_PROFILE,
        } as never,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('foundation reached');
    expect(mockedRunStoryAuthoringStage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stage: 'foundation' }),
    );
  });

  it('repairs concrete fidelity findings once and fails rather than returning an inaccurate proposal', async () => {
    mockedRunStoryAuthoringStage.mockImplementation((_model, call) =>
      Promise.resolve(
        (call.stage === 'structure'
          ? call.system === SOURCE_PARTITION_SYSTEM
            ? SOURCE_PARTITION
            : SOURCE_BATCH
          : {
              ...scopedAudit(call.prompt),
              issues: [
                {
                  category: 'lost_content',
                  source: { start: 0, end: 0 },
                  problem: 'missing the early ending.',
                  correction: 'Retain it.',
                },
              ],
            }) as never,
      ),
    );
    await expect(
      new StoryAuthoringPipelineService().compileScript({
        sourceText: '<paragraph>雨滴向天空升起。</paragraph>',
        document: documentFromStorySource('雨滴向天空升起。'),
        title: '逆流镇',
        creativeProfile: CREATIVE_PROFILE,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('missing the early ending.');
    expect(mockedRunStoryAuthoringStage).toHaveBeenCalledTimes(6);
    expect(mockedRunStoryAuthoringStage.mock.calls[3][1].prompt).toContain(
      'missing the early ending',
    );
  });

  it('rejects an incorrect per-node route even when the auditor reports no general issues', async () => {
    mockedRunStoryAuthoringStage.mockImplementation((_model, call) =>
      Promise.resolve(
        (call.stage === 'structure'
          ? call.system === SOURCE_PARTITION_SYSTEM
            ? SOURCE_PARTITION
            : SOURCE_BATCH
          : {
              issues: [],
              routes: [
                {
                  nodeId: 'source_0',
                  targetNodeId: null,
                  source: { start: 0, end: 0 },
                  correct: false,
                  assessment: 'The route skips the source continuation.',
                },
              ],
            }) as never,
      ),
    );
    await expect(
      new StoryAuthoringPipelineService().compileScript({
        sourceText: '雨滴向天空升起。',
        document: documentFromStorySource('雨滴向天空升起。'),
        title: '逆流镇',
        creativeProfile: CREATIVE_PROFILE,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('skips the source continuation');
    expect(mockedRunStoryAuthoringStage).toHaveBeenCalledTimes(6);
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
