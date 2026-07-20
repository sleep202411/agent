import {
  createDefaultStoryClipPromptDraft,
  LockableInteractiveFilmDraftContentSchema,
  type StoryTrailerPromptDraft,
} from './interactive-film.schema';
import { buildInteractiveFilmTestBundle } from './__tests__/interactive-film-test-bundle';
import {
  compileStoryDirectorPrompt,
  isUnauthoredClipPrompt,
  projectStoryFilmDraftClip,
  projectStoryFilmRevision,
} from './story-film-revision-projector';

const MODEL_ID = '01980f10-7a20-7c01-8000-000000000099';

function completeTrailerPrompt(): StoryTrailerPromptDraft {
  return {
    title: '分支影游测试｜15 秒宣传片',
    description: '从故事世界出发的独立宣传片。',
    targetDurationMs: 15_000,
    generationControl: { mode: 'omni_reference' },
    masterDirection: '电影级夜景，克制悬疑，不剧透结局。',
    referenceRoleNotes: [
      {
        id: 'trailer:ref:cheng',
        role: 'subject',
        referenceId: 'REF-01',
        note: 'Lock Cheng Rui identity, wet field jacket, and restrained performance.',
      },
    ],
    emotionalArc: '好奇转为逼近真相的恐惧。',
    beats: [
      {
        id: 'trailer:beat:1',
        startMs: 0,
        endMs: 15_000,
        visual: '潮湿夜色中的巨龙入口逐步显现。',
        camera: '从远景稳定推进到人物近景。',
        action: '录音机自行启动，两位女主同时停步。',
        performance: '呼吸克制，短促交换视线。',
        emotion: '威胁逐渐逼近。',
        dialogue: '',
        audio: '磁带底噪覆盖潮湿环境声。',
        endState: '停在张开的龙口。',
        continuity: '保持人物服装与录音机一致。',
      },
    ],
    negativeConstraints: ['不揭示四个结局。'],
    continuityNotes: ['角色身份必须跟随正式参考位。'],
  };
}

describe('Story film revision projector', () => {
  it('treats the empty default clip prompt shell as video-first when allowed', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
    const selected = draft.graph.nodes.find((node) => node.kind === 'clip');
    if (!selected || selected.kind !== 'clip') {
      throw new Error('Fixture clip missing.');
    }
    draft.clipPrompts = [
      createDefaultStoryClipPromptDraft({
        graphNodeId: selected.nodeId,
        clipKey: selected.clipKey,
      }),
      ...draft.clipPrompts.filter(
        (prompt) => prompt.graphNodeId !== selected.nodeId,
      ),
    ];
    expect(isUnauthoredClipPrompt(draft.clipPrompts[0])).toBe(true);

    expect(() =>
      projectStoryFilmDraftClip({
        draft,
        frameProfile: 'landscape_16_9',
        graphNodeId: selected.nodeId,
      }),
    ).toThrow(/Too small|expected string/i);

    const projected = projectStoryFilmDraftClip({
      draft,
      frameProfile: 'landscape_16_9',
      graphNodeId: selected.nodeId,
      allowVideoFirst: true,
    });
    expect(projected.prompt.masterPrompt).toContain('Video-first clip');
    expect(projected.outputContract.durationToleranceMs).toBe(30_000);
  });

  it('strictly projects one selected shot while neighbouring draft shots remain incomplete', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
    const selected = draft.graph.nodes.find((node) => node.kind === 'clip');
    const unfinishedPrompt = draft.clipPrompts.find(
      (prompt) => prompt.graphNodeId !== selected?.nodeId,
    );
    if (!selected || selected.kind !== 'clip' || !unfinishedPrompt) {
      throw new Error('Fixture clips missing.');
    }
    unfinishedPrompt.beats = [];

    expect(
      projectStoryFilmDraftClip({
        draft,
        frameProfile: 'landscape_16_9',
        graphNodeId: selected.nodeId,
      }),
    ).toMatchObject({
      graphNodeId: selected.nodeId,
      key: selected.clipKey,
    });
    expect(() =>
      projectStoryFilmRevision({
        draft,
        frameProfile: 'landscape_16_9',
        defaultLocale: 'zh-CN',
        defaultCanonicalModelId: MODEL_ID,
      }),
    ).toThrow();
  });

  it('deterministically projects the locked graph and director prompts', () => {
    const draft = buildInteractiveFilmTestBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;

    const first = projectStoryFilmRevision({
      draft,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });
    const second = projectStoryFilmRevision({
      draft,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });

    expect(second).toEqual(first);
    expect(first.filmSpec).toMatchObject({
      frame: { aspectRatio: '16:9', width: 1920, height: 1080 },
      duration: {
        targetMs: 120_000,
        toleranceMs: 0,
        maxContinuousMs: 15_000,
        maxGeneratedClipMs: 15_000,
      },
      targets: { clipCount: 21, choiceCount: 6, endingCount: 4 },
      generation: { defaultCanonicalModelId: MODEL_ID },
    });
    expect(first.clipSpecs).toHaveLength(21);
    expect(first.trailerSpec).toBeNull();
    expect(
      first.clipSpecs.filter(
        (clip) => clip.generationControl.mode === 'omni_reference',
      ),
    ).toHaveLength(4);
    expect(
      first.clipSpecs.filter(
        (clip) => clip.generationControl.mode === 'frame_lock',
      ),
    ).toHaveLength(17);
  });

  it('treats a checkpoint as a duration-preserving interaction boundary', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
    const checkpointNode = draft.graph.nodes.find(
      (node) => node.exit.kind === 'checkpoint',
    );
    if (!checkpointNode || checkpointNode.exit.kind !== 'checkpoint') {
      throw new Error('Fixture checkpoint missing.');
    }
    const nextNodeId = checkpointNode.exit.nextNodeId;
    checkpointNode.exit = {
      kind: 'auto',
      nextNodeId,
    };

    const projection = projectStoryFilmRevision({
      draft,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });

    expect(projection.filmSpec.duration).toMatchObject({
      targetMs: 120_000,
      toleranceMs: 0,
      maxContinuousMs: 30_000,
    });
    expect(projection.filmSpec.targets.choiceCount).toBe(6);
  });

  it('includes checkpoint continuations in graph cycle detection', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
    const checkpointNode = draft.graph.nodes.find(
      (node) => node.exit.kind === 'checkpoint',
    );
    if (!checkpointNode || checkpointNode.exit.kind !== 'checkpoint') {
      throw new Error('Fixture checkpoint missing.');
    }
    checkpointNode.exit.nextNodeId = checkpointNode.nodeId;

    expect(() =>
      projectStoryFilmRevision({
        draft,
        frameProfile: 'landscape_16_9',
        defaultLocale: 'zh-CN',
        defaultCanonicalModelId: MODEL_ID,
      }),
    ).toThrow(
      `Interactive-film graph contains a cycle at ${checkpointNode.nodeId}.`,
    );
  });

  it('derives total tolerance and uninterrupted duration from authored reaction playback', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
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

    const projection = projectStoryFilmRevision({
      draft,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });

    expect(projection.filmSpec.duration).toMatchObject({
      targetMs: 127_500,
      toleranceMs: 7_500,
      maxContinuousMs: 30_000,
      maxGeneratedClipMs: 15_000,
    });
  });

  it('projects an authored root trailer without changing runtime clip targets', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
    draft.trailerPrompt = completeTrailerPrompt();
    const lockable = LockableInteractiveFilmDraftContentSchema.parse(draft);

    const projection = projectStoryFilmRevision({
      draft: lockable,
      frameProfile: 'portrait_9_16',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });

    expect(projection.filmSpec.targets).toMatchObject({
      clipCount: 21,
      choiceCount: 6,
      endingCount: 4,
    });
    expect(projection.clipSpecs).toHaveLength(21);
    expect(projection.trailerSpec).toMatchObject({
      schemaVersion: 1,
      title: '分支影游测试｜15 秒宣传片',
      targetDurationMs: 15_000,
      generationControl: { mode: 'omni_reference' },
      referenceRoleNotes: [
        expect.objectContaining({
          referenceId: 'REF-01',
          role: 'subject',
        }),
      ],
      outputContract: {
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        durationMs: 15_000,
      },
      prompt: {
        timeline: [
          expect.objectContaining({
            startMs: 0,
            endMs: 15_000,
            performance: '呼吸克制，短促交换视线。',
            endState: '停在张开的龙口。',
          }),
        ],
      },
    });
    expect(projection.trailerSpec?.prompt.masterPrompt).toContain(
      'Reference subject REF-01: Lock Cheng Rui identity',
    );
  });

  it('skips an unfinished optional trailer while projecting complete gameplay', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
    draft.trailerPrompt = completeTrailerPrompt();
    draft.trailerPrompt.masterDirection = '';
    const lockable = LockableInteractiveFilmDraftContentSchema.parse(draft);

    const projection = projectStoryFilmRevision({
      draft: lockable,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });

    expect(projection.clipSpecs).toHaveLength(21);
    expect(projection.filmSpec.targets).toMatchObject({
      clipCount: 21,
      choiceCount: 6,
      endingCount: 4,
    });
    expect(projection.trailerSpec).toBeNull();
  });

  it('locks every clip output to the project frame profile', () => {
    const draft = buildInteractiveFilmTestBundle({
      defaultCanonicalModelId: MODEL_ID,
    }).draftContent;
    const projection = projectStoryFilmRevision({
      draft,
      frameProfile: 'portrait_9_16',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });

    expect(projection.filmSpec.frame).toMatchObject({
      aspectRatio: '9:16',
      width: 1080,
      height: 1920,
    });
    expect(
      projection.clipSpecs.every(
        (clip) =>
          clip.outputContract.aspectRatio === '9:16' &&
          clip.outputContract.width === 1080 &&
          clip.outputContract.height === 1920,
      ),
    ).toBe(true);
  });

  it('preserves micro-performance and end-state direction in the immutable manifest', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
    const prompt = draft.clipPrompts[0];
    expect(prompt).toBeDefined();
    if (!prompt) return;
    prompt.beats[0] = {
      ...prompt.beats[0],
      performance: 'Her lower eyelid trembles once.',
      emotion: 'Fear settles into resolve.',
      endState: 'She holds her gaze on the sealed gate.',
      continuity: 'The brass key remains in her left hand.',
    };
    const lockable = LockableInteractiveFilmDraftContentSchema.parse(draft);
    const projection = projectStoryFilmRevision({
      draft: lockable,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });
    const projected = projection.clipSpecs[0];
    if (!projected) throw new Error('Expected projected clip.');
    const firstBeat = projected.prompt.timeline[0];
    expect(firstBeat).toMatchObject({
      performance: 'Her lower eyelid trembles once.',
      emotion: 'Fear settles into resolve.',
      endState: 'She holds her gaze on the sealed gate.',
      continuity: 'The brass key remains in her left hand.',
    });
    const lockedPrompt = lockable.clipPrompts[0];
    if (!lockedPrompt) throw new Error('Expected the locked director prompt.');
    expect(projected.prompt.masterPrompt).toBe(
      compileStoryDirectorPrompt(lockedPrompt),
    );
    expect(projected.prompt.masterPrompt).not.toContain('Performance:');
  });

  it('derives authoritative locales only from runtime copy and rejects incomplete coverage', () => {
    const draft = structuredClone(
      buildInteractiveFilmTestBundle({
        defaultCanonicalModelId: MODEL_ID,
      }).draftContent,
    );
    draft.storyBible.characters[0].name['fr-FR'] = 'Visiteuse';

    const projection = projectStoryFilmRevision({
      draft,
      frameProfile: 'landscape_16_9',
      defaultLocale: 'zh-CN',
      defaultCanonicalModelId: MODEL_ID,
    });
    expect(projection.filmSpec.locales.enabledLocales).toEqual([
      'zh-CN',
      'en-US',
      'zh-HK',
    ]);

    delete draft.storyBible.endings[0].summary['en-US'];
    expect(() =>
      projectStoryFilmRevision({
        draft,
        frameProfile: 'landscape_16_9',
        defaultLocale: 'zh-CN',
        defaultCanonicalModelId: MODEL_ID,
      }),
    ).toThrow(
      'Runtime locale coverage is incomplete at storyBible.endings.0.summary.en-US',
    );

    expect(() =>
      projectStoryFilmRevision({
        draft: buildInteractiveFilmTestBundle().draftContent,
        frameProfile: 'landscape_16_9',
        defaultLocale: 'ja-JP',
        defaultCanonicalModelId: MODEL_ID,
      }),
    ).toThrow('provide non-empty ja-JP copy');
  });
});
