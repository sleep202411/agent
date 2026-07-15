import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FilmClipSpecSchema,
  FilmReferenceSlotSpecSchema,
  FilmSpecSchema,
  LockableInteractiveFilmDraftContentSchema,
  type FilmCondition,
  type FilmEffect,
  type InteractiveFilmDraftContent,
  type StoryScalarValue,
} from '../interactive-film.schema';
import {
  buildHuBaoVillaImportBundle,
  HU_BAO_VILLA_DEFAULT_CANONICAL_MODEL_ID,
} from './hu-bao-villa.builder';
import { compileStoryDirectorPrompt } from '../story-film-revision-projector';
import {
  HU_BAO_VILLA_DRAFT_CONTENT,
  HU_BAO_VILLA_FRAME_PROFILE,
} from './hu-bao-villa.fixture';
import { parseVideoPromptPack } from './video-prompt-pack';

const promptPackMarkdown = readFileSync(
  resolve(
    __dirname,
    '../../../../../docs/interactive-films/hu-bao-villa-longkou-night-video-prompt-pack-v1.md',
  ),
  'utf8',
);

type GraphNode = InteractiveFilmDraftContent['graph']['nodes'][number];
type RuntimeState = {
  variables: Record<string, StoryScalarValue>;
  flags: Record<string, boolean>;
};

describe('Haw Par Villa product import builder', () => {
  it('builds schema-valid import payloads without mutating the source fixture', () => {
    const sourceBefore = structuredClone(HU_BAO_VILLA_DRAFT_CONTENT);
    const bundle = buildHuBaoVillaImportBundle();

    expect(() =>
      LockableInteractiveFilmDraftContentSchema.parse(bundle.draftContent),
    ).not.toThrow();
    expect(() => FilmSpecSchema.parse(bundle.filmSpec)).not.toThrow();
    expect(bundle.clipSpecs).toHaveLength(21);
    expect(bundle.draftContent.clipPrompts).toHaveLength(21);
    expect(
      bundle.draftContent.clipPrompts.every(
        (prompt) =>
          prompt.masterDirection.trim().length > 0 &&
          prompt.emotionalArc.trim().length > 0 &&
          prompt.beats.length > 0,
      ),
    ).toBe(true);
    expect(
      bundle.clipSpecs.every(
        (clip) => FilmClipSpecSchema.safeParse(clip).success,
      ),
    ).toBe(true);
    expect(bundle.referenceSlotSpecs).toHaveLength(16);
    expect(
      bundle.referenceSlotSpecs.every(
        (slot) => FilmReferenceSlotSpecSchema.safeParse(slot).success,
      ),
    ).toBe(true);
    expect(HU_BAO_VILLA_DRAFT_CONTENT).toEqual(sourceBefore);
    expect(bundle.filmSpec.generation.defaultCanonicalModelId).toBe(
      HU_BAO_VILLA_DEFAULT_CANONICAL_MODEL_ID,
    );
    expect(HU_BAO_VILLA_FRAME_PROFILE).toBe('landscape_16_9');
    expect(bundle.filmSpec.frame).toMatchObject({
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
    });
    expect(
      bundle.clipSpecs.every(
        (clip) =>
          clip.outputContract.aspectRatio === '16:9' &&
          clip.outputContract.width === 1920 &&
          clip.outputContract.height === 1080,
      ),
    ).toBe(true);
  });

  it('materializes 21 clip nodes plus the three post-choice routers', () => {
    const { draftContent, filmSpec, clipSpecs, referenceSlotSpecs } =
      buildHuBaoVillaImportBundle();
    const clipNodes = draftContent.graph.nodes.filter(
      (node): node is Extract<GraphNode, { kind: 'clip' }> =>
        node.kind === 'clip',
    );
    const routerNodes = draftContent.graph.nodes.filter(
      (node): node is Extract<GraphNode, { kind: 'router' }> =>
        node.kind === 'router',
    );
    const choiceStages = new Set(
      clipNodes.flatMap((node) =>
        node.exit.kind === 'choice'
          ? node.exit.choices.map((choice) => choice.choiceId.split(':')[0])
          : [],
      ),
    );

    expect(clipNodes).toHaveLength(21);
    expect(routerNodes.map((node) => node.nodeId).sort()).toEqual([
      'router:S04',
      'router:S05',
      'router:S06',
    ]);
    expect(choiceStages).toEqual(new Set(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']));
    expect(
      clipNodes.filter((node) => node.exit.kind === 'ending'),
    ).toHaveLength(4);
    expect(
      clipNodes.flatMap((node) =>
        node.exit.kind === 'checkpoint'
          ? [[node.clipKey, node.exit.nextNodeId] as const]
          : [],
      ),
    ).toEqual([
      ['S06A', 'clip:E01'],
      ['S06B', 'clip:E02'],
      ['S06C', 'clip:E03'],
      ['S06D', 'clip:E04'],
    ]);
    expect(new Set(clipSpecs.map((clip) => clip.graphNodeId))).toEqual(
      new Set(clipNodes.map((node) => node.nodeId)),
    );
    expect(filmSpec.targets).toEqual({
      clipCount: 21,
      choiceCount: 6,
      endingCount: 4,
    });
    expect(filmSpec.duration).toMatchObject({
      targetMs: 120_000,
      toleranceMs: 0,
      maxContinuousMs: 15_000,
      maxGeneratedClipMs: 15_000,
    });
    expect(filmSpec.locales).toEqual({
      defaultLocale: 'zh-CN',
      enabledLocales: ['zh-CN', 'en-US', 'zh-HK'],
    });
    expect(referenceSlotSpecs.map((slot) => slot.key)).toEqual([
      'REF-01',
      'REF-02',
      'REF-03',
      'REF-04',
      'REF-05',
      'REF-06',
      'REF-07',
      'REF-08',
      'JF-01',
      'JF-02',
      'JF-03',
      'JF-04',
      'JF-05',
      'S00-FIRST',
      'S00-LAST',
      'E04-PREBLACK-END',
    ]);
  });

  it('preserves every authored decision prompt on each source clip exit', () => {
    const { draftContent } = buildHuBaoVillaImportBundle();
    const choiceExits = draftContent.graph.nodes.flatMap((node) =>
      node.kind === 'clip' && node.exit.kind === 'choice' ? [node.exit] : [],
    );

    for (const authoredChoice of HU_BAO_VILLA_DRAFT_CONTENT.choices) {
      const matchingExits = choiceExits.filter(
        (exit) => exit.decisionId === authoredChoice.key,
      );
      const expectedSourceCount =
        'sourceClipKeys' in authoredChoice && authoredChoice.sourceClipKeys
          ? authoredChoice.sourceClipKeys.length
          : 1;
      expect(matchingExits).toHaveLength(expectedSourceCount);
      expect(
        matchingExits.every((exit) => {
          if (
            JSON.stringify(exit.prompt) !==
            JSON.stringify(authoredChoice.prompt)
          ) {
            return false;
          }
          return exit.choices.every((choice, index) => {
            const authoredOption = authoredChoice.options[index];
            return (
              authoredOption !== undefined &&
              JSON.stringify(choice.label) ===
                JSON.stringify(authoredOption.label)
            );
          });
        }),
      ).toBe(true);
    }
  });

  it('turns all parsed model inputs into complete logical-key reference plans', () => {
    const { clipSpecs, clipReferencePlans, referenceSlotSpecs } =
      buildHuBaoVillaImportBundle();
    const planByClip = new Map(
      clipReferencePlans.map((plan) => [plan.clipKey, plan]),
    );
    const slotKindByKey = new Map(
      referenceSlotSpecs.map((slot) => [slot.key, slot.kind]),
    );

    expect(clipReferencePlans).toHaveLength(21);
    expect(new Set(clipReferencePlans.map((plan) => plan.clipKey))).toEqual(
      new Set(clipSpecs.map((clip) => clip.key)),
    );
    expect(
      clipReferencePlans.filter((plan) =>
        plan.bindings.some((binding) => binding.role === 'omni'),
      ),
    ).toHaveLength(4);
    expect(
      clipReferencePlans.filter((plan) =>
        plan.bindings.some((binding) => binding.role === 'first_frame'),
      ),
    ).toHaveLength(17);

    expect(planByClip.get('S00')?.bindings).toEqual([
      { referenceSlotKey: 'REF-01', role: 'omni', position: 0, required: true },
      { referenceSlotKey: 'REF-02', role: 'omni', position: 1, required: true },
      { referenceSlotKey: 'REF-03', role: 'omni', position: 2, required: true },
      { referenceSlotKey: 'REF-04', role: 'omni', position: 3, required: true },
      { referenceSlotKey: 'REF-07', role: 'omni', position: 4, required: true },
    ]);
    expect(planByClip.get('S01A')?.bindings).toEqual([
      {
        referenceSlotKey: 'S00-LAST',
        role: 'first_frame',
        position: 0,
        required: true,
      },
      {
        referenceSlotKey: 'JF-01',
        role: 'last_frame',
        position: 0,
        required: true,
      },
    ]);
    expect(planByClip.get('E04')?.bindings).toEqual([
      {
        referenceSlotKey: 'S00-FIRST',
        role: 'first_frame',
        position: 0,
        required: true,
      },
      {
        referenceSlotKey: 'E04-PREBLACK-END',
        role: 'last_frame',
        position: 0,
        required: true,
      },
    ]);

    for (const clip of clipSpecs) {
      const bindings = planByClip.get(clip.key)?.bindings ?? [];
      const first = bindings.filter(
        (binding) => binding.role === 'first_frame',
      );
      const last = bindings.filter((binding) => binding.role === 'last_frame');
      const omni = bindings.filter((binding) => binding.role === 'omni');
      if (clip.generationControl.mode === 'omni_reference') {
        expect(omni.length).toBeGreaterThan(0);
        expect(first).toHaveLength(0);
        expect(last).toHaveLength(0);
      } else {
        expect(omni).toHaveLength(0);
        expect(first).toHaveLength(1);
        expect(last).toHaveLength(
          clip.generationControl.frameMode === 'first_last_frame' ? 1 : 0,
        );
      }
      for (const binding of bindings) {
        expect(slotKindByKey.has(binding.referenceSlotKey)).toBe(true);
      }
    }
  });

  it('collapses routers into the 41 real clip dependencies and locks every transition', () => {
    const { clipDependencyPlans } = buildHuBaoVillaImportBundle();
    const direct = clipDependencyPlans.filter(
      (dependency) => dependency.transition.kind === 'direct',
    );
    const shared = clipDependencyPlans.filter(
      (dependency) => dependency.transition.kind === 'shared_join_frame',
    );
    const hidden = clipDependencyPlans.filter(
      (dependency) => dependency.transition.kind === 'hidden_cut',
    );

    expect(clipDependencyPlans).toHaveLength(41);
    expect(direct).toEqual([
      {
        predecessorClipKey: 'S00',
        successorClipKey: 'S01A',
        kind: 'continuity',
        transition: { kind: 'direct' },
      },
      {
        predecessorClipKey: 'S00',
        successorClipKey: 'S01B',
        kind: 'continuity',
        transition: { kind: 'direct' },
      },
    ]);
    expect(hidden).toEqual([
      {
        predecessorClipKey: 'S06A',
        successorClipKey: 'E01',
        kind: 'required',
        transition: { kind: 'hidden_cut' },
      },
      {
        predecessorClipKey: 'S06B',
        successorClipKey: 'E02',
        kind: 'required',
        transition: { kind: 'hidden_cut' },
      },
      {
        predecessorClipKey: 'S06C',
        successorClipKey: 'E03',
        kind: 'required',
        transition: { kind: 'hidden_cut' },
      },
      {
        predecessorClipKey: 'S06D',
        successorClipKey: 'E04',
        kind: 'required',
        transition: { kind: 'hidden_cut' },
      },
    ]);
    expect(shared).toHaveLength(35);
    expect(
      shared.reduce<Record<string, number>>((counts, dependency) => {
        if (dependency.transition.kind !== 'shared_join_frame') return counts;
        const key = dependency.transition.joinFrameReferenceSlotKey;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({
      'JF-01': 4,
      'JF-02': 4,
      'JF-03': 6,
      'JF-04': 9,
      'JF-05': 12,
    });
    expect(
      shared.every((dependency) => dependency.kind === 'convergence'),
    ).toBe(true);
  });

  it('models finalAction as a string variable changed only by set_variable', () => {
    const { draftContent } = buildHuBaoVillaImportBundle();
    expect(
      draftContent.storyBible.stateVariables.find(
        (variable) => variable.key === 'finalAction',
      ),
    ).toEqual({
      key: 'finalAction',
      type: 'string',
      initialValue: 'unset',
      allowedValues: ['unset', 'release', 'leave'],
    });

    const finalActionEffects = draftContent.graph.nodes.flatMap((node) => {
      if (node.kind !== 'clip' || node.exit.kind !== 'choice') return [];
      return node.exit.choices.flatMap((choice) =>
        choice.effects.filter(
          (effect) =>
            (effect.kind === 'set_variable' && effect.key === 'finalAction') ||
            (effect.kind === 'set_flag' && effect.flag === 'finalAction'),
        ),
      );
    });

    expect(finalActionEffects).toHaveLength(6);
    expect(
      finalActionEffects.every(
        (effect) =>
          effect.kind === 'set_variable' && effect.key === 'finalAction',
      ),
    ).toBe(true);
    expect(
      new Set(
        finalActionEffects.flatMap((effect) =>
          effect.kind === 'set_variable' ? [effect.value] : [],
        ),
      ),
    ).toEqual(new Set(['release', 'leave']));
  });

  it('preserves each parsed video mode and timed instruction in the immutable manifest', () => {
    const { clipSpecs, draftContent } = buildHuBaoVillaImportBundle();
    const clipByKey = new Map(clipSpecs.map((clip) => [clip.key, clip]));
    const promptByKey = new Map(
      draftContent.clipPrompts.map((prompt) => [prompt.clipKey, prompt]),
    );
    const parsedPrompts = parseVideoPromptPack(promptPackMarkdown);

    for (const parsed of parsedPrompts) {
      const storyKey = storyKeyFromPromptKey(parsed.key);
      const clip = clipByKey.get(storyKey);
      const directorPrompt = promptByKey.get(storyKey);
      expect(clip).toBeDefined();
      expect(directorPrompt).toBeDefined();
      expect(clip?.generationControl).toEqual(parsed.generationControl);
      expect(clip?.prompt.masterPrompt).toBe(
        compileStoryDirectorPrompt(directorPrompt!),
      );
      expect(clip?.prompt.masterPrompt).toContain(parsed.positivePrompt);
      expect(clip?.prompt.negativeConstraints).toEqual(
        parsed.negativeConstraints,
      );
      expect(clip?.prompt.timeline).toEqual(
        parsed.timeline.map((entry, index) => ({
          startMs: entry.startMs,
          endMs: entry.endMs,
          visual: entry.instruction,
          camera: 'Maintain the authored camera axis and continuous shot.',
          action:
            'Execute the authored physical action with believable weight.',
          ...(index === parsed.timeline.length - 1
            ? {
                endState: parsed.endStateContract ?? parsed.acceptance,
              }
            : {}),
        })),
      );
    }

    expect(
      clipSpecs.every(
        (clip) =>
          clip.targetDurationMs === 15_000 &&
          clip.outputContract.durationMs === 15_000,
      ),
    ).toBe(true);
    expect(JSON.stringify(buildHuBaoVillaImportBundle())).not.toMatch(
      /(?:https?|asset|data):\/\//u,
    );
  });

  it('runs all 64 choice paths for exactly 120 seconds to one of four endings', () => {
    const bundle = buildHuBaoVillaImportBundle();
    const endings = new Set<string>();

    for (let choiceMask = 0; choiceMask < 64; choiceMask += 1) {
      const result = runPath(bundle.draftContent, bundle.clipSpecs, choiceMask);
      expect(result.durationMs).toBe(120_000);
      expect(result.clipCount).toBe(8);
      expect(result.choiceCount).toBe(6);
      endings.add(result.endingId);
    }

    expect(endings).toEqual(new Set(['E01', 'E02', 'E03', 'E04']));
  });
});

function runPath(
  draft: InteractiveFilmDraftContent,
  clips: ReturnType<typeof buildHuBaoVillaImportBundle>['clipSpecs'],
  choiceMask: number,
) {
  const nodes = new Map(draft.graph.nodes.map((node) => [node.nodeId, node]));
  const durations = new Map(
    clips.map((clip) => [clip.graphNodeId, clip.targetDurationMs]),
  );
  const state: RuntimeState = {
    variables: Object.fromEntries(
      draft.storyBible.stateVariables.map((variable) => [
        variable.key,
        variable.initialValue,
      ]),
    ),
    flags: {},
  };
  let currentNodeId = draft.graph.entryNodeId;
  let durationMs = 0;
  let clipCount = 0;
  let choiceCount = 0;

  for (let guard = 0; guard < 40; guard += 1) {
    if (!currentNodeId) throw new Error('Path has no current node.');
    const node = nodes.get(currentNodeId);
    if (!node) throw new Error(`Unknown graph node ${currentNodeId}.`);

    if (node.kind === 'clip') {
      durationMs += durations.get(node.nodeId) ?? 0;
      clipCount += 1;
      if (node.exit.kind === 'ending') {
        return {
          endingId: node.exit.endingId,
          durationMs,
          clipCount,
          choiceCount,
        };
      }
      if (node.exit.kind === 'choice') {
        const stage = node.exit.choices[0]?.choiceId.split(':')[0];
        const stageNumber = Number.parseInt(stage?.slice(1) ?? '', 10);
        if (!Number.isInteger(stageNumber)) {
          throw new Error(`Invalid choice stage ${stage ?? '<missing>'}.`);
        }
        const option = node.exit.choices[(choiceMask >> (stageNumber - 1)) & 1];
        if (!option) throw new Error(`Missing option for ${stage}.`);
        option.effects.forEach((effect) => applyEffect(effect, state));
        choiceCount += 1;
        currentNodeId = option.nextNodeId;
        continue;
      }
      if (node.exit.kind === 'checkpoint') {
        currentNodeId = node.exit.nextNodeId;
        continue;
      }
    }

    if (node.exit.kind !== 'auto') {
      throw new Error(`Unsupported exit at ${node.nodeId}.`);
    }
    const matchingRoutes = [...node.exit.routes]
      .sort((left, right) => left.priority - right.priority)
      .filter((candidate) =>
        candidate.when ? evaluateCondition(candidate.when, state) : true,
      );
    if (matchingRoutes.length !== 1) {
      throw new Error(
        `${node.nodeId} matched ${matchingRoutes.length} automatic routes.`,
      );
    }
    const route = matchingRoutes[0];
    if (!route) throw new Error(`No route matched at ${node.nodeId}.`);
    currentNodeId = route.nextNodeId;
  }

  throw new Error('Path did not terminate within the graph guard.');
}

function applyEffect(effect: FilmEffect, state: RuntimeState): void {
  if (effect.kind === 'set_variable') {
    state.variables[effect.key] = effect.value;
    return;
  }
  if (effect.kind === 'increment_variable') {
    const current = state.variables[effect.key];
    if (typeof current !== 'number') {
      throw new Error(`Cannot increment non-numeric variable ${effect.key}.`);
    }
    state.variables[effect.key] = current + effect.amount;
    return;
  }
  if (effect.kind === 'set_flag') {
    state.flags[effect.flag] = effect.value;
    return;
  }
  throw new Error(`Unsupported test effect ${effect.kind}.`);
}

function evaluateCondition(
  condition: FilmCondition,
  state: RuntimeState,
): boolean {
  switch (condition.kind) {
    case 'flag':
      return state.flags[condition.flag] === condition.equals;
    case 'variable': {
      const current = state.variables[condition.key];
      switch (condition.operator) {
        case 'equals':
          return current === condition.value;
        case 'not_equals':
          return current !== condition.value;
        case 'greater_than':
          return compareNumbers(current, condition.value, (a, b) => a > b);
        case 'at_least':
          return compareNumbers(current, condition.value, (a, b) => a >= b);
        case 'less_than':
          return compareNumbers(current, condition.value, (a, b) => a < b);
        case 'at_most':
          return compareNumbers(current, condition.value, (a, b) => a <= b);
      }
      throw new Error('Unsupported variable operator.');
    }
    case 'all':
      return condition.conditions.every((child) =>
        evaluateCondition(child, state),
      );
    case 'any':
      return condition.conditions.some((child) =>
        evaluateCondition(child, state),
      );
    case 'not':
      return !evaluateCondition(condition.condition, state);
    case 'relationship-at-least':
      throw new Error('Relationship conditions are not used by this fixture.');
  }
}

function compareNumbers(
  left: StoryScalarValue,
  right: StoryScalarValue,
  compare: (left: number, right: number) => boolean,
): boolean {
  return typeof left === 'number' && typeof right === 'number'
    ? compare(left, right)
    : false;
}

function storyKeyFromPromptKey(promptKey: string): string {
  const match = promptKey.match(/^hbln-((?:s\d{2}[a-z]?)|(?:e\d{2}))-/u);
  if (!match) throw new Error(`Invalid prompt key ${promptKey}.`);
  return match[1].toUpperCase();
}
