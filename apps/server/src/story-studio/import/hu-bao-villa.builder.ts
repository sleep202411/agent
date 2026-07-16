import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FilmReferenceSlotSpecSchema,
  LockableInteractiveFilmDraftContentSchema,
  type FilmClipSpec,
  type FilmCondition,
  type FilmEffect,
  type FilmReferenceSlotSpec,
  type FilmSpec,
  type InteractiveFilmDraftContent,
  type StoryClipPromptDraft,
} from '../interactive-film.schema';
import { projectStoryFilmRevision } from '../story-film-revision-projector';
import {
  HU_BAO_REFERENCE_SLOTS,
  HU_BAO_VILLA_DRAFT_CONTENT,
  type HuBaoVillaAuthoredChoice,
  type HuBaoVillaChoiceEffect,
} from './hu-bao-villa.fixture';
import {
  parseVideoPromptPack,
  type ParsedVideoPromptClip,
} from './video-prompt-pack';
import { parseStoryBibleSegments, type StoryBibleSegment } from './story-bible';

const STORY_BIBLE_PATH = resolve(
  __dirname,
  '../../../../../docs/interactive-films/hu-bao-villa-longkou-night-story-bible-v1.md',
);
const VIDEO_PROMPT_PACK_PATH = resolve(
  __dirname,
  '../../../../../docs/interactive-films/hu-bao-villa-longkou-night-video-prompt-pack-v1.md',
);

/**
 * Stable bootstrap identity used by the fixture-only import bundle. The real
 * importer should pass the active Seedance canonical model row explicitly.
 */
export const HU_BAO_VILLA_DEFAULT_CANONICAL_MODEL_ID =
  '01980f10-7a20-7c01-8000-000000000002';

const DEFAULT_LOCALE = 'zh-CN';
const CLIP_DURATION_MS = 15_000;
const ROUTER_NODE_IDS = {
  S04: 'router:S04',
  S05: 'router:S05',
  S06: 'router:S06',
} as const;

type GraphNode = InteractiveFilmDraftContent['graph']['nodes'][number];
type ClipGraphNode = Extract<GraphNode, { kind: 'clip' }>;
const AUTHORED_CHOICES: readonly HuBaoVillaAuthoredChoice[] =
  HU_BAO_VILLA_DRAFT_CONTENT.choices;

export interface BuildHuBaoVillaImportBundleOptions {
  storyBibleMarkdown?: string;
  videoPromptPackMarkdown?: string;
  defaultCanonicalModelId?: string;
}

export interface HuBaoVillaImportBundle {
  draftContent: InteractiveFilmDraftContent;
  filmSpec: FilmSpec;
  clipSpecs: FilmClipSpec[];
  referenceSlotSpecs: FilmReferenceSlotSpec[];
  clipReferencePlans: HuBaoVillaClipReferencePlan[];
  clipDependencyPlans: HuBaoVillaClipDependencyPlan[];
}

export interface HuBaoVillaClipReferencePlan {
  clipKey: string;
  bindings: {
    referenceSlotKey: string;
    role: 'omni' | 'first_frame' | 'last_frame';
    position: number;
    required: true;
  }[];
}

export interface HuBaoVillaClipDependencyPlan {
  predecessorClipKey: string;
  successorClipKey: string;
  kind: 'required' | 'continuity' | 'convergence';
  transition:
    | { kind: 'direct' }
    | { kind: 'hidden_cut' }
    | {
        kind: 'shared_join_frame';
        joinFrameReferenceSlotKey: string;
      };
}

/**
 * Converts the authored fixture and its two locked documents into the four
 * product-level Story Studio import payloads. This builder creates metadata
 * only: it never resolves, uploads, or fabricates a media asset.
 */
export function buildHuBaoVillaImportBundle(
  options: BuildHuBaoVillaImportBundleOptions = {},
): HuBaoVillaImportBundle {
  const storySegments = parseStoryBibleSegments(
    options.storyBibleMarkdown ?? readFileSync(STORY_BIBLE_PATH, 'utf8'),
  );
  const videoPrompts = parseVideoPromptPack(
    options.videoPromptPackMarkdown ??
      readFileSync(VIDEO_PROMPT_PACK_PATH, 'utf8'),
  );

  assertLockedDocumentAlignment(storySegments, videoPrompts);

  const promptByStoryKey = new Map(
    videoPrompts.map((clip) => [storyKeyFromPromptKey(clip.key), clip]),
  );
  const mutableDraft = buildDraftContent(storySegments);
  mutableDraft.clipPrompts = storySegments.map((segment) => {
    const prompt = promptByStoryKey.get(segment.key);
    if (!prompt) {
      throw new Error(`No video prompt is locked for ${segment.key}.`);
    }
    return buildClipPromptDraft(segment, prompt);
  });
  const draftContent =
    LockableInteractiveFilmDraftContentSchema.parse(mutableDraft);
  const { filmSpec, clipSpecs } = projectStoryFilmRevision({
    draft: draftContent,
    frameProfile: 'landscape_16_9',
    defaultLocale: DEFAULT_LOCALE,
    defaultCanonicalModelId:
      options.defaultCanonicalModelId ??
      HU_BAO_VILLA_DEFAULT_CANONICAL_MODEL_ID,
  });
  const referenceSlotSpecs = HU_BAO_REFERENCE_SLOTS.map(
    ([key, kind, label, description], index) =>
      FilmReferenceSlotSpecSchema.parse({
        key,
        kind,
        label,
        description,
        required: true,
        rank: index + 1,
      }),
  );
  const clipReferencePlans = buildClipReferencePlans(
    videoPrompts,
    clipSpecs,
    referenceSlotSpecs,
  );
  const clipDependencyPlans = buildClipDependencyPlans(
    draftContent,
    clipReferencePlans,
  );

  return {
    draftContent,
    filmSpec,
    clipSpecs,
    referenceSlotSpecs,
    clipReferencePlans,
    clipDependencyPlans,
  };
}

function buildClipReferencePlans(
  videoPrompts: ParsedVideoPromptClip[],
  clipSpecs: FilmClipSpec[],
  referenceSlotSpecs: FilmReferenceSlotSpec[],
): HuBaoVillaClipReferencePlan[] {
  const clipByKey = new Map(clipSpecs.map((clip) => [clip.key, clip]));
  const slotKindByKey = new Map(
    referenceSlotSpecs.map((slot) => [slot.key, slot.kind]),
  );

  const plans = videoPrompts.map((prompt) => {
    const clipKey = storyKeyFromPromptKey(prompt.key);
    const clip = clipByKey.get(clipKey);
    if (!clip) throw new Error(`No FilmClipSpec exists for ${clipKey}.`);

    const bindings = prompt.modelInputs.map((input) => ({
      referenceSlotKey: input.referenceSlotKey,
      role: input.kind === 'omni_reference' ? ('omni' as const) : input.kind,
      position: input.position,
      required: true as const,
    }));

    assertClipReferencePlan(clip, bindings, slotKindByKey);
    return { clipKey, bindings };
  });

  if (
    plans.length !== clipSpecs.length ||
    new Set(plans.map((plan) => plan.clipKey)).size !== clipSpecs.length
  ) {
    throw new Error('Every FilmClipSpec must have exactly one reference plan.');
  }
  return plans;
}

function assertClipReferencePlan(
  clip: FilmClipSpec,
  bindings: HuBaoVillaClipReferencePlan['bindings'],
  slotKindByKey: Map<string, FilmReferenceSlotSpec['kind']>,
): void {
  for (const binding of bindings) {
    const slotKind = slotKindByKey.get(binding.referenceSlotKey);
    if (!slotKind) {
      throw new Error(
        `${clip.key} binds unknown reference slot ${binding.referenceSlotKey}.`,
      );
    }
    const isFrameSlot =
      slotKind === 'first_frame' ||
      slotKind === 'last_frame' ||
      slotKind === 'join_frame';
    if (binding.role === 'first_frame' && !isFrameSlot) {
      throw new Error(`${clip.key} first frame must bind a locked frame slot.`);
    }
    if (binding.role === 'last_frame' && !isFrameSlot) {
      throw new Error(`${clip.key} last frame must bind a locked frame slot.`);
    }
    if (binding.role === 'omni' && isFrameSlot) {
      throw new Error(`${clip.key} Omni input cannot bind a frame slot.`);
    }
  }

  const omni = bindings.filter((binding) => binding.role === 'omni');
  const first = bindings.filter((binding) => binding.role === 'first_frame');
  const last = bindings.filter((binding) => binding.role === 'last_frame');
  if (clip.generationControl.mode === 'omni_reference') {
    if (
      omni.length === 0 ||
      first.length !== 0 ||
      last.length !== 0 ||
      omni.some((binding, index) => binding.position !== index)
    ) {
      throw new Error(
        `${clip.key} has an invalid ordered Omni reference plan.`,
      );
    }
    return;
  }

  const expectedLastFrames =
    clip.generationControl.frameMode === 'first_last_frame' ? 1 : 0;
  if (
    omni.length !== 0 ||
    first.length !== 1 ||
    first[0]?.position !== 0 ||
    last.length !== expectedLastFrames ||
    last.some((binding) => binding.position !== 0)
  ) {
    throw new Error(`${clip.key} has an invalid Frame Lock reference plan.`);
  }
}

function buildClipDependencyPlans(
  draftContent: InteractiveFilmDraftContent,
  referencePlans: HuBaoVillaClipReferencePlan[],
): HuBaoVillaClipDependencyPlan[] {
  const nodeById = new Map(
    draftContent.graph.nodes.map((node) => [node.nodeId, node]),
  );
  const referencePlanByClipKey = new Map(
    referencePlans.map((plan) => [plan.clipKey, plan]),
  );
  const dependencies: HuBaoVillaClipDependencyPlan[] = [];

  for (const predecessor of draftContent.graph.nodes) {
    if (predecessor.kind !== 'clip' || predecessor.exit.kind === 'ending') {
      continue;
    }
    const startingNodeIds =
      predecessor.exit.kind === 'choice'
        ? predecessor.exit.choices.map((choice) => choice.nextNodeId)
        : predecessor.exit.kind === 'checkpoint'
          ? [predecessor.exit.nextNodeId]
          : predecessor.exit.nextNodeId
            ? [predecessor.exit.nextNodeId]
            : [];
    const successors = new Map<string, ClipGraphNode>();
    for (const nodeId of startingNodeIds) {
      for (const successor of collectNextClipNodes(
        nodeId,
        nodeById,
        new Set(),
      )) {
        successors.set(successor.nodeId, successor);
      }
    }

    for (const successor of successors.values()) {
      dependencies.push(
        classifyClipDependency(
          predecessor.clipKey,
          successor.clipKey,
          referencePlanByClipKey,
        ),
      );
    }
  }

  const identity = (dependency: HuBaoVillaClipDependencyPlan) =>
    `${dependency.predecessorClipKey}->${dependency.successorClipKey}`;
  if (new Set(dependencies.map(identity)).size !== dependencies.length) {
    throw new Error('Collapsed FilmClip dependencies must be unique.');
  }
  if (dependencies.length !== 41) {
    throw new Error(
      `Haw Par Villa graph must collapse to 41 FilmClip edges; received ${dependencies.length}.`,
    );
  }
  return dependencies;
}

function collectNextClipNodes(
  nodeId: string,
  nodeById: Map<string, GraphNode>,
  visitedRouters: Set<string>,
): ClipGraphNode[] {
  const node = nodeById.get(nodeId);
  if (!node)
    throw new Error(`Dependency graph references unknown node ${nodeId}.`);
  if (node.kind === 'clip') return [node];
  if (visitedRouters.has(nodeId)) {
    throw new Error(`Dependency graph contains a router cycle at ${nodeId}.`);
  }

  const nextVisited = new Set(visitedRouters).add(nodeId);
  return node.exit.routes.flatMap((route) =>
    collectNextClipNodes(route.nextNodeId, nodeById, nextVisited),
  );
}

function classifyClipDependency(
  predecessorClipKey: string,
  successorClipKey: string,
  referencePlanByClipKey: Map<string, HuBaoVillaClipReferencePlan>,
): HuBaoVillaClipDependencyPlan {
  const predecessor = referencePlanByClipKey.get(predecessorClipKey);
  const successor = referencePlanByClipKey.get(successorClipKey);
  if (!predecessor || !successor) {
    throw new Error(
      `Dependency ${predecessorClipKey}->${successorClipKey} has no reference plan.`,
    );
  }

  const predecessorLast = predecessor.bindings.find(
    (binding) => binding.role === 'last_frame',
  );
  const successorFirst = successor.bindings.find(
    (binding) => binding.role === 'first_frame',
  );
  if (
    predecessorLast &&
    successorFirst &&
    predecessorLast.referenceSlotKey === successorFirst.referenceSlotKey &&
    predecessorLast.referenceSlotKey.startsWith('JF-')
  ) {
    return {
      predecessorClipKey,
      successorClipKey,
      kind: 'convergence',
      transition: {
        kind: 'shared_join_frame',
        joinFrameReferenceSlotKey: predecessorLast.referenceSlotKey,
      },
    };
  }

  if (
    predecessorClipKey === 'S00' &&
    successorFirst?.referenceSlotKey === 'S00-LAST'
  ) {
    return {
      predecessorClipKey,
      successorClipKey,
      kind: 'continuity',
      transition: { kind: 'direct' },
    };
  }

  if (
    predecessorClipKey.startsWith('S06') &&
    successorClipKey.startsWith('E')
  ) {
    return {
      predecessorClipKey,
      successorClipKey,
      kind: 'required',
      transition: { kind: 'hidden_cut' },
    };
  }

  throw new Error(
    `Dependency ${predecessorClipKey}->${successorClipKey} has no locked transition contract.`,
  );
}

function buildDraftContent(
  storySegments: StoryBibleSegment[],
): InteractiveFilmDraftContent {
  const storySegmentByKey = new Map(
    storySegments.map((segment) => [segment.key, segment]),
  );

  return {
    storyBible: {
      logline: HU_BAO_VILLA_DRAFT_CONTENT.logline,
      synopsis: storySegments
        .map((segment) => `${segment.key}｜${segment.title}：${segment.visual}`)
        .join('\n'),
      worldview: HU_BAO_VILLA_DRAFT_CONTENT.worldRules.join('\n'),
      storyRules: [...HU_BAO_VILLA_DRAFT_CONTENT.worldRules],
      characters: HU_BAO_VILLA_DRAFT_CONTENT.characters.map((character) => ({
        id: character.key,
        name: { [DEFAULT_LOCALE]: character.name },
        role: character.role,
        summary: characterSummary(character),
        playable:
          character.key === HU_BAO_VILLA_DRAFT_CONTENT.player.characterKey,
        continuityRules:
          'performanceGuardrail' in character
            ? [character.visualLock, character.performanceGuardrail]
            : [character.visualLock],
      })),
      locations: HU_BAO_REFERENCE_SLOTS.filter(
        ([, kind]) => kind === 'location',
      ).map(([, , label]) => label),
      props: HU_BAO_REFERENCE_SLOTS.filter(([, kind]) => kind === 'prop').map(
        ([, , label]) => label,
      ),
      stateVariables: [
        ...HU_BAO_VILLA_DRAFT_CONTENT.stateVariables.map((variable) => ({
          key: variable.key,
          type: 'number' as const,
          initialValue: variable.initial,
          minimum: 0,
        })),
        {
          key: 'c4Choice',
          type: 'string' as const,
          initialValue: 'unset',
          allowedValues: ['unset', 'A', 'B'],
        },
        {
          key: 'finalAction',
          type: 'string' as const,
          initialValue: 'unset',
          allowedValues: ['unset', 'release', 'leave'],
        },
      ],
      endings: HU_BAO_VILLA_DRAFT_CONTENT.endings.map((ending) => {
        const endingSegment = storySegmentByKey.get(ending.endingClipKey);
        if (!endingSegment) {
          throw new Error(
            `Missing story-bible ending ${ending.endingClipKey}.`,
          );
        }
        if (ending.summary['zh-CN'] !== endingSegment.visual) {
          throw new Error(
            `Localized ending summary ${ending.key} drifted from the locked story bible.`,
          );
        }
        return {
          id: ending.key,
          title: { ...ending.title },
          summary: { ...ending.summary },
          kind: endingKind(ending.key),
        };
      }),
    },
    graph: {
      entryNodeId: clipNodeId('S00'),
      nodes: [
        ...storySegments.map(buildClipGraphNode),
        buildS04Router(),
        buildS05Router(),
        buildS06Router(),
      ],
    },
    clipPrompts: [],
    trailerPrompt: null,
    productionNotes: [HU_BAO_VILLA_DRAFT_CONTENT.coreQuestion],
  };
}

function characterSummary(
  character: (typeof HU_BAO_VILLA_DRAFT_CONTENT.characters)[number],
): string {
  const summary = [character.objective] as string[];
  if ('innerNeed' in character) summary.push(character.innerNeed);
  if ('secret' in character) summary.push(character.secret);
  if ('keyLine' in character) summary.push(character.keyLine);
  return summary.join('\n');
}

function endingKind(
  endingKey: (typeof HU_BAO_VILLA_DRAFT_CONTENT.endings)[number]['key'],
): InteractiveFilmDraftContent['storyBible']['endings'][number]['kind'] {
  switch (endingKey) {
    case 'E01':
      return 'truth';
    case 'E02':
      return 'echo';
    case 'E03':
      return 'bond';
    case 'E04':
      return 'failure';
  }
}

function buildClipGraphNode(segment: StoryBibleSegment): ClipGraphNode {
  if (segment.key.startsWith('E')) {
    return {
      kind: 'clip',
      nodeId: clipNodeId(segment.key),
      clipKey: segment.key,
      exit: { kind: 'ending', endingId: segment.key },
    };
  }

  if (segment.nextChoiceKey) {
    return {
      kind: 'clip',
      nodeId: clipNodeId(segment.key),
      clipKey: segment.key,
      exit: buildChoiceExit(segment.nextChoiceKey),
    };
  }

  if (segment.nextTargetKey?.startsWith('E')) {
    if (!segment.key.startsWith('S06')) {
      throw new Error(
        `Only an S06 consequence clip may continue into an ending; received ${segment.key}.`,
      );
    }
    return {
      kind: 'clip',
      nodeId: clipNodeId(segment.key),
      clipKey: segment.key,
      exit: {
        kind: 'checkpoint',
        nextNodeId: clipNodeId(segment.nextTargetKey),
      },
    };
  }

  throw new Error(`Story segment ${segment.key} has no supported exit.`);
}

function buildChoiceExit(choiceKey: string): ClipGraphNode['exit'] {
  const choice = AUTHORED_CHOICES.find(
    (candidate) => candidate.key === choiceKey,
  );
  if (!choice) throw new Error(`Unknown authored choice ${choiceKey}.`);

  return {
    kind: 'choice',
    decisionId: choice.key,
    prompt: { ...choice.prompt },
    trigger: { kind: 'media-ended' },
    choices: choice.options.map((option) => {
      const effects = option.effects.map(translateFixtureEffect);
      if (choice.key === 'C4') {
        effects.push({
          kind: 'set_variable',
          key: 'c4Choice',
          value: option.key,
        });
      }
      return {
        choiceId: `${choice.key}:${option.key}`,
        label: { ...option.label },
        effects,
        nextNodeId: choiceTargetNodeId(choice.key, option.key),
        afterSelect: { kind: 'immediate' as const },
      };
    }),
  };
}

function translateFixtureEffect(effect: HuBaoVillaChoiceEffect): FilmEffect {
  if ('variable' in effect) {
    return {
      kind: 'increment_variable',
      key: effect.variable,
      amount: effect.add,
    };
  }
  return {
    kind: 'set_variable',
    key: effect.flag,
    value: effect.set,
  };
}

function choiceTargetNodeId(choiceKey: string, optionKey: string): string {
  switch (choiceKey) {
    case 'C1':
      return clipNodeId(`S01${optionKey}`);
    case 'C2':
      return clipNodeId(`S02${optionKey}`);
    case 'C3':
      return clipNodeId(`S03${optionKey}`);
    case 'C4':
      return ROUTER_NODE_IDS.S04;
    case 'C5':
      return ROUTER_NODE_IDS.S05;
    case 'C6':
      return ROUTER_NODE_IDS.S06;
    default:
      throw new Error(`Unknown choice target for ${choiceKey}.`);
  }
}

function buildS04Router(): GraphNode {
  return {
    kind: 'router',
    nodeId: ROUTER_NODE_IDS.S04,
    exit: {
      kind: 'auto',
      routes: [
        route('S04A', variable('bond', 'at_least', 2), 1),
        route(
          'S04B',
          all(
            variable('bond', 'less_than', 2),
            variable('c4Choice', 'equals', 'A'),
          ),
          2,
        ),
        route(
          'S04C',
          all(
            variable('bond', 'less_than', 2),
            variable('c4Choice', 'equals', 'B'),
          ),
          3,
        ),
      ],
    },
  };
}

function buildS05Router(): GraphNode {
  return {
    kind: 'router',
    nodeId: ROUTER_NODE_IDS.S05,
    exit: {
      kind: 'auto',
      routes: [
        route('S05A', variable('truth', 'at_least', 3), 1),
        route('S05B', variable('echo', 'at_least', 3), 2),
        route(
          'S05C',
          all(
            variable('truth', 'less_than', 3),
            variable('echo', 'less_than', 3),
          ),
          3,
        ),
      ],
    },
  };
}

function buildS06Router(): GraphNode {
  return {
    kind: 'router',
    nodeId: ROUTER_NODE_IDS.S06,
    exit: {
      kind: 'auto',
      routes: [
        route(
          'S06A',
          all(
            variable('finalAction', 'equals', 'release'),
            variable('truth', 'at_least', 3),
          ),
          1,
        ),
        route(
          'S06B',
          all(
            variable('finalAction', 'equals', 'release'),
            variable('truth', 'less_than', 3),
          ),
          2,
        ),
        route(
          'S06C',
          all(
            variable('finalAction', 'equals', 'leave'),
            variable('bond', 'at_least', 2),
          ),
          3,
        ),
        route(
          'S06D',
          all(
            variable('finalAction', 'equals', 'leave'),
            variable('bond', 'less_than', 2),
          ),
          4,
        ),
      ],
    },
  };
}

function route(
  targetClipKey: string,
  when: FilmCondition | undefined,
  priority: number,
) {
  return {
    nextNodeId: clipNodeId(targetClipKey),
    ...(when ? { when } : {}),
    priority,
  };
}

function variable(
  key: string,
  operator: Extract<FilmCondition, { kind: 'variable' }>['operator'],
  value: string | number,
): FilmCondition {
  return { kind: 'variable', key, operator, value };
}

function all(...conditions: FilmCondition[]): FilmCondition {
  return { kind: 'all', conditions };
}

function clipNodeId(clipKey: string): string {
  return `clip:${clipKey}`;
}

function buildClipPromptDraft(
  segment: StoryBibleSegment,
  prompt: ParsedVideoPromptClip,
): StoryClipPromptDraft {
  return {
    graphNodeId: clipNodeId(segment.key),
    clipKey: segment.key,
    title: segment.title,
    description: segment.visual,
    targetDurationMs: segment.durationMs,
    generationControl: prompt.generationControl,
    masterDirection: prompt.positivePrompt,
    referenceRoleNotes: prompt.modelInputs.map((input, index) => ({
      id: `reference:${index + 1}`,
      role: input.kind,
      referenceId: input.referenceSlotKey,
      note: prompt.modelInput,
    })),
    emotionalArc: prompt.emotionalArc ?? prompt.acceptance,
    beats: prompt.timeline.map((entry, index) => ({
      id: `beat:${index + 1}`,
      startMs: entry.startMs,
      endMs: entry.endMs,
      visual: entry.instruction,
      camera: 'Maintain the authored camera axis and continuous shot.',
      action: 'Execute the authored physical action with believable weight.',
      performance: '',
      emotion: '',
      dialogue: '',
      audio: '',
      endState:
        index === prompt.timeline.length - 1
          ? (prompt.endStateContract ?? prompt.acceptance)
          : '',
      continuity: '',
    })),
    negativeConstraints: [...prompt.negativeConstraints],
    continuityNotes: [
      prompt.productionDependencies,
      prompt.acceptance,
      ...segment.dialogue.map((line) => `${line.speaker}：${line.text}`),
    ],
  };
}

function assertLockedDocumentAlignment(
  storySegments: StoryBibleSegment[],
  videoPrompts: ParsedVideoPromptClip[],
): void {
  const expectedCount = HU_BAO_VILLA_DRAFT_CONTENT.experience.clipCount;
  if (
    storySegments.length !== expectedCount ||
    videoPrompts.length !== expectedCount
  ) {
    throw new Error(
      `Locked documents must both contain ${expectedCount} clips; received ${storySegments.length} story segments and ${videoPrompts.length} prompts.`,
    );
  }

  const storyKeys = new Set(storySegments.map((segment) => segment.key));
  const promptStoryKeys = videoPrompts.map((clip) =>
    storyKeyFromPromptKey(clip.key),
  );
  if (
    promptStoryKeys.some((key) => !storyKeys.has(key)) ||
    new Set(promptStoryKeys).size !== expectedCount
  ) {
    throw new Error('Story-bible and video-prompt clip keys are not aligned.');
  }

  for (const segment of storySegments) {
    if (segment.durationMs !== CLIP_DURATION_MS) {
      throw new Error(
        `${segment.key} must be locked to ${CLIP_DURATION_MS}ms.`,
      );
    }
  }
  for (const prompt of videoPrompts) {
    if (prompt.durationMs !== CLIP_DURATION_MS) {
      throw new Error(`${prompt.key} must be locked to ${CLIP_DURATION_MS}ms.`);
    }
  }
}

function storyKeyFromPromptKey(promptKey: string): string {
  const match = promptKey.match(/^hbln-((?:s\d{2}[a-z]?)|(?:e\d{2}))-/u);
  if (!match) {
    throw new Error(`Video prompt key ${promptKey} has no story clip key.`);
  }
  return match[1].toUpperCase();
}
