import { z } from 'zod';

/**
 * Interactive-film authoring contracts.
 *
 * These schemas describe creator-owned inputs, not the compiled player
 * manifest. Builds must emit the shared InteractiveFilmReleaseSchema v1;
 * authoring DTOs deliberately do not duplicate runtime media records.
 */

export const INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION =
  'interactive-film-draft-v2' as const;
export const INTERACTIVE_FILM_RUNTIME_SCHEMA_VERSION = 1 as const;

export const StoryUuidSchema = z.string().uuid();
export const StoryStableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, 'Use a stable identifier.');
export const FilmClipKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_-]*$/, 'Use an uppercase stable clip key.');
export const FilmReferenceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_-]*$/, 'Use an uppercase stable reference key.');
export const StoryLocaleSchema = z.string().trim().min(2).max(16);
export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest.');

export const LocalizedTextSchema = z
  .record(StoryLocaleSchema, z.string().trim().min(1).max(4_000))
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one localized value.',
  });

/** Mutable-draft text may be empty while the creator is still authoring. */
export const DraftLocalizedTextSchema = z.record(
  StoryLocaleSchema,
  z.string().max(4_000),
);

export const StoryScalarValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type StoryScalarValue = z.infer<typeof StoryScalarValueSchema>;

export const StoryStateVariableSchema = z.discriminatedUnion('type', [
  z
    .object({
      key: StoryStableIdSchema,
      type: z.literal('boolean'),
      initialValue: z.boolean(),
    })
    .strict(),
  z
    .object({
      key: StoryStableIdSchema,
      type: z.literal('number'),
      initialValue: z.number().finite(),
      minimum: z.number().finite().optional(),
      maximum: z.number().finite().optional(),
    })
    .strict(),
  z
    .object({
      key: StoryStableIdSchema,
      type: z.literal('string'),
      initialValue: z.string().max(2_000),
      allowedValues: z.array(z.string().max(2_000)).min(1).max(100).optional(),
    })
    .strict(),
]);
export type StoryStateVariable = z.infer<typeof StoryStateVariableSchema>;

export type FilmCondition =
  | { kind: 'flag'; flag: string; equals: boolean }
  | {
      kind: 'variable';
      key: string;
      operator:
        | 'equals'
        | 'not_equals'
        | 'greater_than'
        | 'at_least'
        | 'less_than'
        | 'at_most';
      value: StoryScalarValue;
    }
  | { kind: 'relationship-at-least'; characterId: string; value: number }
  | { kind: 'all'; conditions: FilmCondition[] }
  | { kind: 'any'; conditions: FilmCondition[] }
  | { kind: 'not'; condition: FilmCondition };

export const FilmConditionSchema: z.ZodType<FilmCondition> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('flag'),
        flag: StoryStableIdSchema,
        equals: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('variable'),
        key: StoryStableIdSchema,
        operator: z.enum([
          'equals',
          'not_equals',
          'greater_than',
          'at_least',
          'less_than',
          'at_most',
        ]),
        value: StoryScalarValueSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('relationship-at-least'),
        characterId: StoryStableIdSchema,
        value: z.number().finite(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('all'),
        conditions: z.array(FilmConditionSchema).min(1).max(50),
      })
      .strict(),
    z
      .object({
        kind: z.literal('any'),
        conditions: z.array(FilmConditionSchema).min(1).max(50),
      })
      .strict(),
    z
      .object({ kind: z.literal('not'), condition: FilmConditionSchema })
      .strict(),
  ]),
);

export const FilmEffectSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('set_variable'),
      key: StoryStableIdSchema,
      value: StoryScalarValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('increment_variable'),
      key: StoryStableIdSchema,
      amount: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set_flag'),
      flag: StoryStableIdSchema,
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('adjust_relationship'),
      characterId: StoryStableIdSchema,
      amount: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unlock_ending'),
      endingId: StoryStableIdSchema,
    })
    .strict(),
]);
export type FilmEffect = z.infer<typeof FilmEffectSchema>;

export const StoryCharacterSchema = z
  .object({
    id: StoryStableIdSchema,
    name: DraftLocalizedTextSchema,
    role: z.string().max(160),
    summary: z.string().max(4_000),
    playable: z.boolean().default(false),
    continuityRules: z.array(z.string().trim().min(1).max(1_000)).max(50),
  })
  .strict();

export const StoryEndingSchema = z
  .object({
    id: StoryStableIdSchema,
    title: DraftLocalizedTextSchema,
    summary: DraftLocalizedTextSchema,
    kind: z.enum(['truth', 'bond', 'echo', 'failure', 'hidden', 'custom']),
  })
  .strict();

export const StoryGraphChoiceSchema = z
  .object({
    choiceId: StoryStableIdSchema,
    label: DraftLocalizedTextSchema,
    accessibilityLabel: DraftLocalizedTextSchema.optional(),
    visibleWhen: FilmConditionSchema.optional(),
    effects: z.array(FilmEffectSchema).max(30).default([]),
    nextNodeId: StoryStableIdSchema,
    afterSelect: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('immediate') }).strict(),
        z
          .object({
            kind: z.literal('play'),
            reactionClipKey: FilmClipKeySchema,
          })
          .strict(),
      ])
      .default({ kind: 'immediate' }),
  })
  .strict();

const StoryAutoRouteSchema = z
  .object({
    nextNodeId: StoryStableIdSchema,
    when: FilmConditionSchema.optional(),
    priority: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

const StoryClipAutoExitSchema = z
  .object({
    kind: z.literal('auto'),
    nextNodeId: StoryStableIdSchema.nullable(),
  })
  .strict();

const StoryRouterAutoExitSchema = z
  .object({
    kind: z.literal('auto'),
    routes: z.array(StoryAutoRouteSchema).max(20),
  })
  .strict();

const StoryChoiceExitSchema = z
  .object({
    kind: z.literal('choice'),
    decisionId: StoryStableIdSchema,
    // Early interactive-film drafts stored the decision prompt only in the
    // story bible. Keep the mutable graph boundary able to read those rows;
    // locking still validates the projected production structure.
    prompt: DraftLocalizedTextSchema.default({}),
    trigger: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('media-ended') }).strict(),
      z
        .object({
          kind: z.literal('timecode'),
          atMs: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
    choices: z.array(StoryGraphChoiceSchema).max(6),
  })
  .strict();

/**
 * A deliberate interaction boundary that asks the viewer to continue without
 * recording a narrative choice. Player copy belongs to the built-in runtime
 * checkpoint renderer, keeping authoring graphs free from duplicated product
 * UI text.
 */
export const StoryCheckpointExitSchema = z
  .object({
    kind: z.literal('checkpoint'),
    nextNodeId: StoryStableIdSchema,
  })
  .strict();
export type StoryCheckpointExit = z.infer<typeof StoryCheckpointExitSchema>;

const StoryEndingExitSchema = z
  .object({
    kind: z.literal('ending'),
    endingId: StoryStableIdSchema,
  })
  .strict();

const StoryClipGraphNodeSchema = z
  .object({
    kind: z.literal('clip'),
    nodeId: StoryStableIdSchema,
    clipKey: FilmClipKeySchema,
    exit: z.discriminatedUnion('kind', [
      StoryClipAutoExitSchema,
      StoryChoiceExitSchema,
      StoryCheckpointExitSchema,
      StoryEndingExitSchema,
    ]),
  })
  .strict();

/**
 * A graph-only routing node. It owns no generated video and can only choose
 * an automatic conditional route. The compiler materializes its runtime
 * representation without inventing another FilmClip or video asset.
 */
const StoryRouterGraphNodeSchema = z
  .object({
    kind: z.literal('router'),
    nodeId: StoryStableIdSchema,
    exit: StoryRouterAutoExitSchema,
  })
  .strict();

export const StoryGraphNodeSchema = z.discriminatedUnion('kind', [
  StoryClipGraphNodeSchema,
  StoryRouterGraphNodeSchema,
]);

/** Mutable graph shape. Referential and completeness checks run on lock. */
export const InteractiveFilmStoryGraphSchema = z
  .object({
    entryNodeId: StoryStableIdSchema.nullable(),
    nodes: z.array(StoryGraphNodeSchema).max(500),
  })
  .strict();

export const StoryClipPromptGenerationControlSchema = z.discriminatedUnion(
  'mode',
  [
    z
      .object({
        mode: z.literal('frame_lock'),
        frameMode: z.enum(['first_frame', 'first_last_frame']),
      })
      .strict(),
    z.object({ mode: z.literal('omni_reference') }).strict(),
  ],
);

export const StoryClipReferenceRoleNoteSchema = z
  .object({
    id: StoryStableIdSchema,
    role: z.enum([
      'subject',
      'location',
      'prop',
      'style',
      'first_frame',
      'last_frame',
      'omni_reference',
      'other',
    ]),
    referenceId: z.string().max(120),
    note: z.string().max(2_000),
  })
  .strict();

export const StoryClipPromptBeatSchema = z
  .object({
    id: StoryStableIdSchema,
    startMs: z
      .number()
      .int()
      .nonnegative()
      .max(10 * 60 * 1_000),
    endMs: z
      .number()
      .int()
      .nonnegative()
      .max(10 * 60 * 1_000),
    visual: z.string().max(4_000),
    camera: z.string().max(2_000),
    action: z.string().max(4_000),
    performance: z.string().max(2_000),
    emotion: z.string().max(2_000),
    dialogue: z.string().max(2_000),
    audio: z.string().max(2_000),
    endState: z.string().max(2_000),
    continuity: z.string().max(2_000),
  })
  .strict();

export const StoryClipPromptDraftSchema = z
  .object({
    graphNodeId: StoryStableIdSchema,
    clipKey: FilmClipKeySchema,
    title: z.string().max(240),
    description: z.string().max(4_000),
    targetDurationMs: z
      .number()
      .int()
      .positive()
      .max(10 * 60 * 1_000),
    generationControl: StoryClipPromptGenerationControlSchema,
    masterDirection: z.string().max(20_000),
    referenceRoleNotes: z.array(StoryClipReferenceRoleNoteSchema).max(100),
    emotionalArc: z.string().max(4_000),
    beats: z.array(StoryClipPromptBeatSchema).max(200),
    negativeConstraints: z.array(z.string().max(1_000)).max(100),
    continuityNotes: z.array(z.string().max(2_000)).max(100),
  })
  .strict();
export type StoryClipPromptDraft = z.infer<typeof StoryClipPromptDraftSchema>;

/**
 * Mutable director design for the optional project-root trailer. It deliberately
 * has no graph identity: a trailer is revision-scoped promotional media, not a
 * hidden runtime clip.
 */
export const StoryTrailerPromptDraftSchema = z
  .object({
    title: z.string().max(240),
    description: z.string().max(4_000),
    targetDurationMs: z
      .number()
      .int()
      .positive()
      .max(10 * 60 * 1_000),
    generationControl: StoryClipPromptGenerationControlSchema,
    masterDirection: z.string().max(20_000),
    referenceRoleNotes: z.array(StoryClipReferenceRoleNoteSchema).max(100),
    emotionalArc: z.string().max(4_000),
    beats: z.array(StoryClipPromptBeatSchema).max(200),
    negativeConstraints: z.array(z.string().max(1_000)).max(100),
    continuityNotes: z.array(z.string().max(2_000)).max(100),
  })
  .strict();
export type StoryTrailerPromptDraft = z.infer<
  typeof StoryTrailerPromptDraftSchema
>;

const InteractiveFilmDraftContentBaseSchema = z
  .object({
    storyBible: z
      .object({
        logline: z.string().max(1_000),
        synopsis: z.string().max(20_000),
        worldview: z.string().max(20_000),
        storyRules: z.array(z.string().max(2_000)).max(100),
        characters: z.array(StoryCharacterSchema).max(100),
        locations: z.array(z.string().max(500)).max(200),
        props: z.array(z.string().max(500)).max(200),
        stateVariables: z.array(StoryStateVariableSchema).max(200),
        endings: z.array(StoryEndingSchema).max(100),
      })
      .strict(),
    graph: InteractiveFilmStoryGraphSchema,
    clipPrompts: z.array(StoryClipPromptDraftSchema).max(500).default([]),
    // v1 draft evolution follows the existing normalisation convention used
    // by clipPrompts: old stored heads parse to the explicit absence of a
    // trailer without inventing a production record.
    trailerPrompt: StoryTrailerPromptDraftSchema.nullable().default(null),
    productionNotes: z.array(z.string().max(2_000)).max(200).default([]),
  })
  .strict();
type InteractiveFilmDraftContentBase = z.infer<
  typeof InteractiveFilmDraftContentBaseSchema
>;

export const InteractiveFilmDraftContentSchema =
  InteractiveFilmDraftContentBaseSchema.superRefine((draft, context) => {
    addDuplicateStableIdentifierIssues(
      draft.storyBible.characters,
      (character) => character.id,
      ['storyBible', 'characters'],
      'id',
      context,
    );
    addDuplicateStableIdentifierIssues(
      draft.storyBible.stateVariables,
      (variable) => variable.key,
      ['storyBible', 'stateVariables'],
      'key',
      context,
    );
    validateCanonicalDecisionDefinitions(draft, context);
    validateMutableClipPromptStructure(draft, context);
  }).transform((draft) => normalizeDraftClipPrompts(draft));
export type InteractiveFilmDraftContent = z.infer<
  typeof InteractiveFilmDraftContentSchema
>;

interface RuntimeLocalizedCopy {
  value: Record<string, string>;
  path: PropertyKey[];
}

export interface InteractiveFilmRuntimeLocaleCoverageIssue {
  locale: string;
  path: PropertyKey[];
}

/**
 * Runtime locales are derived only from copy that ships in the player. World
 * bible metadata (for example a translated character name) must never silently
 * widen the release locale contract.
 */
export function collectInteractiveFilmRuntimeLocales(
  draft: InteractiveFilmDraftContent,
  defaultLocale?: string,
): string[] {
  const locales = new Set<string>(defaultLocale ? [defaultLocale] : []);
  runtimeLocalizedCopies(draft).forEach((copy) => {
    Object.keys(copy.value).forEach((locale) => locales.add(locale));
  });
  const ordered = [...locales].sort();
  if (!defaultLocale) return ordered;
  return [
    defaultLocale,
    ...ordered.filter((locale) => locale !== defaultLocale),
  ];
}

export function findInteractiveFilmRuntimeLocaleCoverageIssues(
  draft: InteractiveFilmDraftContent,
  enabledLocales: readonly string[],
): InteractiveFilmRuntimeLocaleCoverageIssue[] {
  return runtimeLocalizedCopies(draft).flatMap((copy) =>
    enabledLocales.flatMap((locale) =>
      copy.value[locale]?.trim()
        ? []
        : [{ locale, path: [...copy.path, locale] }],
    ),
  );
}

function runtimeLocalizedCopies(
  draft: InteractiveFilmDraftContent,
): RuntimeLocalizedCopy[] {
  return [
    ...draft.storyBible.endings.flatMap((ending, endingIndex) => [
      {
        value: ending.title,
        path: ['storyBible', 'endings', endingIndex, 'title'],
      },
      {
        value: ending.summary,
        path: ['storyBible', 'endings', endingIndex, 'summary'],
      },
    ]),
    ...draft.graph.nodes.flatMap((node, nodeIndex) => {
      if (node.exit.kind !== 'choice') return [];
      return [
        {
          value: node.exit.prompt,
          path: ['graph', 'nodes', nodeIndex, 'exit', 'prompt'],
        },
        ...node.exit.choices.flatMap((choice, choiceIndex) => [
          {
            value: choice.label,
            path: [
              'graph',
              'nodes',
              nodeIndex,
              'exit',
              'choices',
              choiceIndex,
              'label',
            ],
          },
          ...(choice.accessibilityLabel
            ? [
                {
                  value: choice.accessibilityLabel,
                  path: [
                    'graph',
                    'nodes',
                    nodeIndex,
                    'exit',
                    'choices',
                    choiceIndex,
                    'accessibilityLabel',
                  ],
                },
              ]
            : []),
        ]),
      ];
    }),
  ];
}

export const EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT: InteractiveFilmDraftContent =
  {
    storyBible: {
      logline: '',
      synopsis: '',
      worldview: '',
      storyRules: [],
      characters: [],
      locations: [],
      props: [],
      stateVariables: [],
      endings: [],
    },
    graph: { entryNodeId: null, nodes: [] },
    clipPrompts: [],
    trailerPrompt: null,
    productionNotes: [],
  };

/**
 * Creates the explicit mutable authoring shell for a clip. This is not a
 * FilmClipSpec and carries no output contract, production version, or take
 * state. Empty direction fields are intentional until revision lock.
 */
export function createDefaultStoryClipPromptDraft(input: {
  graphNodeId: string;
  clipKey: string;
}): StoryClipPromptDraft {
  return {
    graphNodeId: input.graphNodeId,
    clipKey: input.clipKey,
    title: input.clipKey,
    description: '',
    targetDurationMs: 15_000,
    generationControl: { mode: 'frame_lock', frameMode: 'first_frame' },
    masterDirection: '',
    referenceRoleNotes: [],
    emotionalArc: '',
    beats: [
      {
        id: 'beat:1',
        startMs: 0,
        endMs: 15_000,
        visual: '',
        camera: '',
        action: '',
        performance: '',
        emotion: '',
        dialogue: '',
        audio: '',
        endState: '',
        continuity: '',
      },
    ],
    negativeConstraints: [],
    continuityNotes: [],
  };
}

function normalizeDraftClipPrompts(
  draft: InteractiveFilmDraftContentBase,
): InteractiveFilmDraftContentBase {
  const existingByNodeId = new Map(
    draft.clipPrompts.map((prompt) => [prompt.graphNodeId, prompt]),
  );
  return {
    ...draft,
    clipPrompts: draft.graph.nodes.flatMap((node) =>
      node.kind === 'clip'
        ? [
            existingByNodeId.get(node.nodeId) ??
              createDefaultStoryClipPromptDraft({
                graphNodeId: node.nodeId,
                clipKey: node.clipKey,
              }),
          ]
        : [],
    ),
  };
}

function validateMutableClipPromptStructure(
  draft: InteractiveFilmDraftContentBase,
  context: z.RefinementCtx,
): void {
  addDuplicateStableIdentifierIssues(
    draft.clipPrompts,
    (prompt) => prompt.graphNodeId,
    ['clipPrompts'],
    'graphNodeId',
    context,
  );
  addDuplicateStableIdentifierIssues(
    draft.clipPrompts,
    (prompt) => prompt.clipKey,
    ['clipPrompts'],
    'clipKey',
    context,
  );
  const clipNodeById = new Map(
    draft.graph.nodes.flatMap((node) =>
      node.kind === 'clip' ? [[node.nodeId, node] as const] : [],
    ),
  );
  draft.clipPrompts.forEach((prompt, promptIndex) => {
    const node = clipNodeById.get(prompt.graphNodeId);
    if (!node) {
      context.addIssue({
        code: 'custom',
        path: ['clipPrompts', promptIndex, 'graphNodeId'],
        message: `Unknown clip graph node ${prompt.graphNodeId}.`,
      });
    } else if (node.clipKey !== prompt.clipKey) {
      context.addIssue({
        code: 'custom',
        path: ['clipPrompts', promptIndex, 'clipKey'],
        message: `Clip prompt key ${prompt.clipKey} does not match graph clip ${node.clipKey}.`,
      });
    }
    addDuplicateStableIdentifierIssues(
      prompt.referenceRoleNotes,
      (note) => note.id,
      ['clipPrompts', promptIndex, 'referenceRoleNotes'],
      'id',
      context,
    );
    addDuplicateStableIdentifierIssues(
      prompt.beats,
      (beat) => beat.id,
      ['clipPrompts', promptIndex, 'beats'],
      'id',
      context,
    );
  });
}

/**
 * A stable decision may be rendered after more than one predecessor clip.
 * Those copies are one authored decision, not independent definitions: copy
 * and interaction semantics must remain identical while each predecessor is
 * free to route the same option to its own continuation node.
 */
function validateCanonicalDecisionDefinitions(
  draft: InteractiveFilmDraftContentBase,
  context: z.RefinementCtx,
): void {
  type ChoiceExit = z.infer<typeof StoryChoiceExitSchema>;
  const decisions = new Map<
    string,
    { exit: ChoiceExit; nodeId: string; nodeIndex: number }
  >();

  draft.graph.nodes.forEach((node, nodeIndex) => {
    if (node.kind !== 'clip' || node.exit.kind !== 'choice') return;
    const canonical = decisions.get(node.exit.decisionId);
    if (!canonical) {
      decisions.set(node.exit.decisionId, {
        exit: node.exit,
        nodeId: node.nodeId,
        nodeIndex,
      });
      return;
    }

    const conflictingField = findDecisionSemanticConflict(
      canonical.exit,
      node.exit,
    );
    if (!conflictingField) return;
    context.addIssue({
      code: 'custom',
      path: ['graph', 'nodes', nodeIndex, 'exit', 'decisionId'],
      message: `Decision ${node.exit.decisionId} conflicts with its canonical definition on node ${canonical.nodeId}: ${conflictingField} must match.`,
    });
  });
}

function findDecisionSemanticConflict(
  canonical: z.infer<typeof StoryChoiceExitSchema>,
  candidate: z.infer<typeof StoryChoiceExitSchema>,
): string | null {
  if (!semanticValuesEqual(canonical.prompt, candidate.prompt)) return 'prompt';
  if (!semanticValuesEqual(canonical.trigger, candidate.trigger)) {
    return 'trigger';
  }

  const canonicalChoices = new Map(
    canonical.choices.map((choice) => [choice.choiceId, choice]),
  );
  const candidateChoices = new Map(
    candidate.choices.map((choice) => [choice.choiceId, choice]),
  );
  if (
    canonicalChoices.size !== candidateChoices.size ||
    [...canonicalChoices.keys()].some(
      (choiceId) => !candidateChoices.has(choiceId),
    )
  ) {
    return 'choiceId set';
  }

  for (const [choiceId, canonicalChoice] of canonicalChoices) {
    const candidateChoice = candidateChoices.get(choiceId);
    if (!candidateChoice) return 'choiceId set';
    for (const field of [
      'label',
      'accessibilityLabel',
      'visibleWhen',
      'effects',
      'afterSelect',
    ] as const) {
      if (
        !semanticValuesEqual(canonicalChoice[field], candidateChoice[field])
      ) {
        return `choice ${choiceId} ${field}`;
      }
    }
  }

  // nextNodeId intentionally is not part of the canonical decision. The same
  // decision can be presented after alternate predecessor clips whose visual
  // branches continue through different graph nodes.
  return null;
}

function semanticValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => semanticValuesEqual(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        semanticValuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function scalarMatchesVariableType(
  value: StoryScalarValue,
  type: StoryStateVariable['type'],
): boolean {
  return typeof value === type;
}

/**
 * Revision-lock gate. PUT /draft intentionally uses the permissive mutable
 * schema above; POST /revisions/lock parses the stored head through this one.
 */
export function createLockableInteractiveFilmDraftContentSchema(
  defaultLocale?: string,
) {
  const normalizedDefaultLocale = defaultLocale
    ? StoryLocaleSchema.parse(defaultLocale)
    : undefined;
  return InteractiveFilmDraftContentSchema.superRefine((draft, context) => {
    validateLockableDraft(draft, context, normalizedDefaultLocale);
  });
}

export const LockableInteractiveFilmDraftContentSchema =
  createLockableInteractiveFilmDraftContentSchema();

function validateLockableDraft(
  draft: InteractiveFilmDraftContent,
  context: z.RefinementCtx,
  defaultLocale?: string,
): void {
  const requireText = (value: string, path: PropertyKey[]) => {
    if (!value.trim()) {
      context.addIssue({
        code: 'custom',
        path,
        message: 'Required before locking a revision.',
      });
    }
  };
  const requireLocalizedText = (
    value: Record<string, string>,
    path: PropertyKey[],
  ) => {
    const entries = Object.entries(value);
    if (entries.length === 0 || entries.every(([, text]) => !text.trim())) {
      context.addIssue({
        code: 'custom',
        path,
        message: 'Provide at least one non-empty localized value.',
      });
    }
  };
  const unique = <T>(
    values: T[],
    id: (value: T) => string,
    path: PropertyKey[],
    field: string,
  ) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const key = id(value);
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: [...path, index, field],
          message: `Duplicate stable identifier ${key}.`,
        });
      }
      seen.add(key);
    });
    return seen;
  };
  const validateVideoPrompt = (
    prompt: StoryClipPromptDraft | StoryTrailerPromptDraft,
    promptPath: PropertyKey[],
    subject: 'clip' | 'trailer',
  ) => {
    requireText(prompt.title, [...promptPath, 'title']);
    requireText(prompt.masterDirection, [...promptPath, 'masterDirection']);
    requireText(prompt.emotionalArc, [...promptPath, 'emotionalArc']);
    prompt.referenceRoleNotes.forEach((note, noteIndex) => {
      requireText(note.referenceId, [
        ...promptPath,
        'referenceRoleNotes',
        noteIndex,
        'referenceId',
      ]);
      requireText(note.note, [
        ...promptPath,
        'referenceRoleNotes',
        noteIndex,
        'note',
      ]);
    });
    prompt.negativeConstraints.forEach((constraint, constraintIndex) =>
      requireText(constraint, [
        ...promptPath,
        'negativeConstraints',
        constraintIndex,
      ]),
    );
    prompt.continuityNotes.forEach((note, noteIndex) =>
      requireText(note, [...promptPath, 'continuityNotes', noteIndex]),
    );
    if (prompt.beats.length === 0) {
      context.addIssue({
        code: 'custom',
        path: [...promptPath, 'beats'],
        message: `A lockable ${subject} prompt needs at least one time-coded beat.`,
      });
    }
    let previousEndMs = 0;
    prompt.beats.forEach((beat, beatIndex) => {
      const beatPath = [...promptPath, 'beats', beatIndex];
      requireText(beat.visual, [...beatPath, 'visual']);
      requireText(beat.camera, [...beatPath, 'camera']);
      requireText(beat.action, [...beatPath, 'action']);
      if (beat.endMs <= beat.startMs) {
        context.addIssue({
          code: 'custom',
          path: [...beatPath, 'endMs'],
          message: 'Beat endMs must be greater than startMs.',
        });
      }
      if (beatIndex === 0 && beat.startMs !== 0) {
        context.addIssue({
          code: 'custom',
          path: [...beatPath, 'startMs'],
          message: `The first ${subject} prompt beat must start at 0ms.`,
        });
      } else if (beat.startMs < previousEndMs) {
        context.addIssue({
          code: 'custom',
          path: [...beatPath, 'startMs'],
          message: `${subject === 'clip' ? 'Clip' : 'Trailer'} prompt beats must be ordered and non-overlapping.`,
        });
      } else if (beatIndex > 0 && beat.startMs > previousEndMs) {
        context.addIssue({
          code: 'custom',
          path: [...beatPath, 'startMs'],
          message: `${subject === 'clip' ? 'Clip' : 'Trailer'} prompt beats must be contiguous with no uncovered time.`,
        });
      }
      if (beat.endMs > prompt.targetDurationMs) {
        context.addIssue({
          code: 'custom',
          path: [...beatPath, 'endMs'],
          message: 'Beat endMs cannot exceed targetDurationMs.',
        });
      }
      previousEndMs = Math.max(previousEndMs, beat.endMs);
    });
    const finalBeat = prompt.beats.at(-1);
    if (finalBeat && finalBeat.endMs !== prompt.targetDurationMs) {
      context.addIssue({
        code: 'custom',
        path: [...promptPath, 'beats', prompt.beats.length - 1, 'endMs'],
        message: `The final ${subject} prompt beat must end exactly at targetDurationMs.`,
      });
    }
  };

  requireText(draft.storyBible.logline, ['storyBible', 'logline']);
  requireText(draft.storyBible.synopsis, ['storyBible', 'synopsis']);
  requireText(draft.storyBible.worldview, ['storyBible', 'worldview']);
  draft.storyBible.storyRules.forEach((rule, index) =>
    requireText(rule, ['storyBible', 'storyRules', index]),
  );
  draft.productionNotes.forEach((note, index) =>
    requireText(note, ['productionNotes', index]),
  );

  if (draft.storyBible.characters.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['storyBible', 'characters'],
      message: 'A lockable story needs at least one character.',
    });
  }
  if (draft.storyBible.endings.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['storyBible', 'endings'],
      message: 'A lockable story needs at least one ending.',
    });
  }
  if (draft.graph.nodes.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['graph', 'nodes'],
      message: 'A lockable story needs at least one graph node.',
    });
  }
  if (!draft.graph.entryNodeId) {
    context.addIssue({
      code: 'custom',
      path: ['graph', 'entryNodeId'],
      message: 'A lockable story needs an entry node.',
    });
  }

  const characterIds = new Set(
    draft.storyBible.characters.map((character) => character.id),
  );
  draft.storyBible.characters.forEach((character, index) => {
    requireLocalizedText(character.name, [
      'storyBible',
      'characters',
      index,
      'name',
    ]);
    requireText(character.role, ['storyBible', 'characters', index, 'role']);
    requireText(character.summary, [
      'storyBible',
      'characters',
      index,
      'summary',
    ]);
    character.continuityRules.forEach((rule, ruleIndex) =>
      requireText(rule, [
        'storyBible',
        'characters',
        index,
        'continuityRules',
        ruleIndex,
      ]),
    );
  });

  const endingIds = unique(
    draft.storyBible.endings,
    (value) => value.id,
    ['storyBible', 'endings'],
    'id',
  );
  draft.storyBible.endings.forEach((ending, index) => {
    requireLocalizedText(ending.title, [
      'storyBible',
      'endings',
      index,
      'title',
    ]);
    requireLocalizedText(ending.summary, [
      'storyBible',
      'endings',
      index,
      'summary',
    ]);
  });

  const enabledLocales = collectInteractiveFilmRuntimeLocales(
    draft,
    defaultLocale,
  );
  findInteractiveFilmRuntimeLocaleCoverageIssues(draft, enabledLocales).forEach(
    (issue) => {
      context.addIssue({
        code: 'custom',
        path: issue.path,
        message: `Provide non-empty ${issue.locale} runtime copy.`,
      });
    },
  );

  const variables = new Map(
    draft.storyBible.stateVariables.map((variable) => [variable.key, variable]),
  );
  draft.storyBible.stateVariables.forEach((variable, index) => {
    if (variable.type === 'number') {
      if (
        variable.minimum !== undefined &&
        variable.maximum !== undefined &&
        variable.minimum > variable.maximum
      ) {
        context.addIssue({
          code: 'custom',
          path: ['storyBible', 'stateVariables', index, 'minimum'],
          message: 'minimum must not exceed maximum.',
        });
      }
      if (
        variable.minimum !== undefined &&
        variable.initialValue < variable.minimum
      ) {
        context.addIssue({
          code: 'custom',
          path: ['storyBible', 'stateVariables', index, 'initialValue'],
          message: 'initialValue is below minimum.',
        });
      }
      if (
        variable.maximum !== undefined &&
        variable.initialValue > variable.maximum
      ) {
        context.addIssue({
          code: 'custom',
          path: ['storyBible', 'stateVariables', index, 'initialValue'],
          message: 'initialValue is above maximum.',
        });
      }
    }
    if (
      variable.type === 'string' &&
      variable.allowedValues &&
      !variable.allowedValues.includes(variable.initialValue)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['storyBible', 'stateVariables', index, 'initialValue'],
        message: 'initialValue must be one of allowedValues.',
      });
    }
  });

  draft.clipPrompts.forEach((prompt, promptIndex) =>
    validateVideoPrompt(prompt, ['clipPrompts', promptIndex], 'clip'),
  );
  if (draft.trailerPrompt) {
    validateVideoPrompt(draft.trailerPrompt, ['trailerPrompt'], 'trailer');
  }

  const nodeIds = unique(
    draft.graph.nodes,
    (value) => value.nodeId,
    ['graph', 'nodes'],
    'nodeId',
  );
  const clipKeys = unique(
    draft.graph.nodes.filter((node) => node.kind === 'clip'),
    (value) => value.clipKey,
    ['graph', 'nodes'],
    'clipKey',
  );
  if (draft.graph.entryNodeId && !nodeIds.has(draft.graph.entryNodeId)) {
    context.addIssue({
      code: 'custom',
      path: ['graph', 'entryNodeId'],
      message: `Unknown entry node ${draft.graph.entryNodeId}.`,
    });
  }

  const validateCondition = (condition: FilmCondition, path: PropertyKey[]) => {
    if (condition.kind === 'variable') {
      const variable = variables.get(condition.key);
      if (!variable) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'key'],
          message: `Unknown state variable ${condition.key}.`,
        });
      } else {
        const numericOperator =
          condition.operator === 'greater_than' ||
          condition.operator === 'at_least' ||
          condition.operator === 'less_than' ||
          condition.operator === 'at_most';
        if (numericOperator && variable.type !== 'number') {
          context.addIssue({
            code: 'custom',
            path: [...path, 'operator'],
            message: `${condition.operator} requires a numeric state variable.`,
          });
        }
        if (numericOperator && typeof condition.value !== 'number') {
          context.addIssue({
            code: 'custom',
            path: [...path, 'value'],
            message: `${condition.operator} requires a numeric comparison value.`,
          });
        }
        if (
          (condition.operator === 'equals' ||
            condition.operator === 'not_equals') &&
          !scalarMatchesVariableType(condition.value, variable.type)
        ) {
          context.addIssue({
            code: 'custom',
            path: [...path, 'value'],
            message: `${condition.operator} value must match the ${variable.type} type of state variable ${variable.key}.`,
          });
        }
      }
    }
    if (
      condition.kind === 'relationship-at-least' &&
      !characterIds.has(condition.characterId)
    ) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'characterId'],
        message: `Unknown character ${condition.characterId}.`,
      });
    }
    if (condition.kind === 'all' || condition.kind === 'any') {
      condition.conditions.forEach((child, index) =>
        validateCondition(child, [...path, 'conditions', index]),
      );
    }
    if (condition.kind === 'not') {
      validateCondition(condition.condition, [...path, 'condition']);
    }
  };
  const validateEffect = (effect: FilmEffect, path: PropertyKey[]) => {
    if (
      effect.kind === 'set_variable' ||
      effect.kind === 'increment_variable'
    ) {
      const variable = variables.get(effect.key);
      if (!variable) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'key'],
          message: `Unknown state variable ${effect.key}.`,
        });
      } else if (effect.kind === 'increment_variable') {
        if (variable.type !== 'number') {
          context.addIssue({
            code: 'custom',
            path: [...path, 'key'],
            message: 'increment_variable requires a numeric state variable.',
          });
        }
      } else if (!scalarMatchesVariableType(effect.value, variable.type)) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'value'],
          message: `set_variable value must match the ${variable.type} type of state variable ${variable.key}.`,
        });
      } else if (
        variable.type === 'number' &&
        typeof effect.value === 'number'
      ) {
        if (variable.minimum !== undefined && effect.value < variable.minimum) {
          context.addIssue({
            code: 'custom',
            path: [...path, 'value'],
            message: `set_variable value is below the minimum for ${variable.key}.`,
          });
        }
        if (variable.maximum !== undefined && effect.value > variable.maximum) {
          context.addIssue({
            code: 'custom',
            path: [...path, 'value'],
            message: `set_variable value is above the maximum for ${variable.key}.`,
          });
        }
      } else if (
        variable.type === 'string' &&
        typeof effect.value === 'string' &&
        variable.allowedValues &&
        !variable.allowedValues.includes(effect.value)
      ) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'value'],
          message: `set_variable value must be one of the allowedValues for ${variable.key}.`,
        });
      }
    }
    if (
      effect.kind === 'adjust_relationship' &&
      !characterIds.has(effect.characterId)
    ) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'characterId'],
        message: `Unknown character ${effect.characterId}.`,
      });
    }
    if (effect.kind === 'unlock_ending' && !endingIds.has(effect.endingId)) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'endingId'],
        message: `Unknown ending ${effect.endingId}.`,
      });
    }
  };

  draft.graph.nodes.forEach((node, nodeIndex) => {
    const exitPath: PropertyKey[] = ['graph', 'nodes', nodeIndex, 'exit'];
    if (node.kind === 'clip' && node.exit.kind === 'auto') {
      if (node.exit.nextNodeId === null) {
        context.addIssue({
          code: 'custom',
          path: [...exitPath, 'nextNodeId'],
          message: 'A clip continuation needs a target node.',
        });
      } else if (!nodeIds.has(node.exit.nextNodeId)) {
        context.addIssue({
          code: 'custom',
          path: [...exitPath, 'nextNodeId'],
          message: `Unknown target node ${node.exit.nextNodeId}.`,
        });
      }
    }
    if (node.kind === 'router') {
      if (node.exit.routes.length === 0) {
        context.addIssue({
          code: 'custom',
          path: [...exitPath, 'routes'],
          message: 'An automatic exit needs at least one route.',
        });
      }
      node.exit.routes.forEach((route, routeIndex) => {
        if (!nodeIds.has(route.nextNodeId)) {
          context.addIssue({
            code: 'custom',
            path: [...exitPath, 'routes', routeIndex, 'nextNodeId'],
            message: `Unknown target node ${route.nextNodeId}.`,
          });
        }
        if (route.when) {
          validateCondition(route.when, [
            ...exitPath,
            'routes',
            routeIndex,
            'when',
          ]);
        }
      });
    }
    if (node.exit.kind === 'choice') {
      requireLocalizedText(node.exit.prompt, [...exitPath, 'prompt']);
      if (node.exit.choices.length < 2) {
        context.addIssue({
          code: 'custom',
          path: [...exitPath, 'choices'],
          message: 'A choice exit needs at least two choices.',
        });
      }
      unique(
        node.exit.choices,
        (choice) => choice.choiceId,
        [...exitPath, 'choices'],
        'choiceId',
      );
      node.exit.choices.forEach((choice, choiceIndex) => {
        const choicePath = [...exitPath, 'choices', choiceIndex];
        requireLocalizedText(choice.label, [...choicePath, 'label']);
        if (choice.accessibilityLabel) {
          requireLocalizedText(choice.accessibilityLabel, [
            ...choicePath,
            'accessibilityLabel',
          ]);
        }
        if (!nodeIds.has(choice.nextNodeId)) {
          context.addIssue({
            code: 'custom',
            path: [...choicePath, 'nextNodeId'],
            message: `Unknown target node ${choice.nextNodeId}.`,
          });
        }
        if (
          choice.afterSelect.kind === 'play' &&
          !clipKeys.has(choice.afterSelect.reactionClipKey)
        ) {
          context.addIssue({
            code: 'custom',
            path: [...choicePath, 'afterSelect', 'reactionClipKey'],
            message: `Unknown reaction clip ${choice.afterSelect.reactionClipKey}.`,
          });
        }
        if (choice.visibleWhen) {
          validateCondition(choice.visibleWhen, [...choicePath, 'visibleWhen']);
        }
        choice.effects.forEach((effect, effectIndex) =>
          validateEffect(effect, [...choicePath, 'effects', effectIndex]),
        );
      });
    }
    if (
      node.kind === 'clip' &&
      node.exit.kind === 'checkpoint' &&
      !nodeIds.has(node.exit.nextNodeId)
    ) {
      context.addIssue({
        code: 'custom',
        path: [...exitPath, 'nextNodeId'],
        message: `Unknown target node ${node.exit.nextNodeId}.`,
      });
    }
    if (
      node.kind === 'clip' &&
      node.exit.kind === 'ending' &&
      !endingIds.has(node.exit.endingId)
    ) {
      context.addIssue({
        code: 'custom',
        path: [...exitPath, 'endingId'],
        message: `Unknown ending ${node.exit.endingId}.`,
      });
    }
  });
}

function addDuplicateStableIdentifierIssues<T>(
  values: T[],
  id: (value: T) => string,
  path: PropertyKey[],
  field: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const key = id(value);
    if (seen.has(key)) {
      context.addIssue({
        code: 'custom',
        path: [...path, index, field],
        message: `Duplicate stable identifier ${key}.`,
      });
    }
    seen.add(key);
  });
}

export const FilmFrameRateSchema = z
  .object({
    numerator: z.number().int().positive().max(240_000),
    denominator: z.number().int().positive().max(10_000),
  })
  .strict();

export const FilmAspectRatioSchema = z.enum(['16:9', '9:16']);
export type FilmAspectRatio = z.infer<typeof FilmAspectRatioSchema>;

export const FilmSpecSchema = z
  .object({
    runtimeSchemaVersion: z.literal(INTERACTIVE_FILM_RUNTIME_SCHEMA_VERSION),
    frame: z
      .object({
        aspectRatio: FilmAspectRatioSchema,
        width: z.number().int().positive().max(16_384),
        height: z.number().int().positive().max(16_384),
        framesPerSecond: FilmFrameRateSchema,
      })
      .strict(),
    audioSampleRateHz: z.union([z.literal(44_100), z.literal(48_000)]),
    duration: z
      .object({
        targetMs: z
          .number()
          .int()
          .positive()
          .max(24 * 60 * 60 * 1_000),
        toleranceMs: z.number().int().nonnegative().max(60_000),
        maxContinuousMs: z
          .number()
          .int()
          .positive()
          .max(10 * 60 * 1_000),
        maxGeneratedClipMs: z
          .number()
          .int()
          .positive()
          .max(10 * 60 * 1_000),
      })
      .strict(),
    targets: z
      .object({
        clipCount: z.number().int().positive().max(10_000),
        choiceCount: z.number().int().nonnegative().max(10_000),
        endingCount: z.number().int().positive().max(1_000),
      })
      .strict(),
    locales: z
      .object({
        defaultLocale: StoryLocaleSchema,
        enabledLocales: z.array(StoryLocaleSchema).min(1).max(50),
      })
      .strict(),
    generation: z.object({ defaultCanonicalModelId: StoryUuidSchema }).strict(),
  })
  .strict()
  .superRefine((spec, context) => {
    if (!dimensionsMatchAspectRatio(spec.frame)) {
      context.addIssue({
        code: 'custom',
        path: ['frame'],
        message: `Frame dimensions must have an exact ${spec.frame.aspectRatio} ratio.`,
      });
    }
    if (spec.duration.maxGeneratedClipMs > spec.duration.maxContinuousMs) {
      context.addIssue({
        code: 'custom',
        path: ['duration', 'maxGeneratedClipMs'],
        message: 'Generated clip duration cannot exceed maxContinuousMs.',
      });
    }
    if (!spec.locales.enabledLocales.includes(spec.locales.defaultLocale)) {
      context.addIssue({
        code: 'custom',
        path: ['locales', 'defaultLocale'],
        message: 'defaultLocale must be included in enabledLocales.',
      });
    }
    if (
      new Set(spec.locales.enabledLocales).size !==
      spec.locales.enabledLocales.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['locales', 'enabledLocales'],
        message: 'enabledLocales must not contain duplicates.',
      });
    }
  });
export type FilmSpec = z.infer<typeof FilmSpecSchema>;

export const FilmGenerationControlSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('frame_lock'),
      frameMode: z.enum(['first_frame', 'first_last_frame']),
    })
    .strict(),
  z.object({ mode: z.literal('omni_reference') }).strict(),
]);
export type FilmGenerationControl = z.infer<typeof FilmGenerationControlSchema>;

export const FilmPromptTimelineEntrySchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    visual: z.string().trim().min(1).max(4_000),
    camera: z.string().trim().min(1).max(2_000),
    action: z.string().trim().min(1).max(4_000),
    performance: z.string().trim().max(2_000).optional(),
    emotion: z.string().trim().max(2_000).optional(),
    dialogue: z.string().trim().max(2_000).optional(),
    audio: z.string().trim().max(2_000).optional(),
    endState: z.string().trim().max(4_000).optional(),
    continuity: z.string().trim().max(4_000).optional(),
  })
  .strict()
  .refine((entry) => entry.endMs > entry.startMs, {
    message: 'endMs must be greater than startMs.',
    path: ['endMs'],
  });

export const FilmDialogueWindowSchema = z
  .object({
    id: StoryStableIdSchema,
    speakerId: StoryStableIdSchema.optional(),
    source: z.enum(['on_screen', 'voice_over', 'off_screen']),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: LocalizedTextSchema,
    delivery: z.string().trim().max(1_000).optional(),
  })
  .strict()
  .refine((window) => window.endMs > window.startMs, {
    message: 'endMs must be greater than startMs.',
    path: ['endMs'],
  });

export const FilmClipSpecSchema = z
  .object({
    key: FilmClipKeySchema,
    graphNodeId: StoryStableIdSchema,
    kind: z.enum(['opening', 'scene', 'ending']),
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4_000).default(''),
    rank: z.number().int().nonnegative().max(100_000),
    targetDurationMs: z
      .number()
      .int()
      .positive()
      .max(10 * 60 * 1_000),
    generationControl: FilmGenerationControlSchema,
    prompt: z
      .object({
        // Immutable provider-neutral director manifest. Provider adapters may
        // compact this into a smaller request budget, but the revision plane
        // must preserve the complete authored intent.
        masterPrompt: z.string().trim().min(1).max(100_000),
        negativeConstraints: z
          .array(z.string().trim().min(1).max(1_000))
          .max(100),
        timeline: z.array(FilmPromptTimelineEntrySchema).min(1).max(200),
      })
      .strict(),
    dialogueWindows: z.array(FilmDialogueWindowSchema).max(100),
    outputContract: z
      .object({
        aspectRatio: FilmAspectRatioSchema,
        width: z.number().int().positive().max(16_384),
        height: z.number().int().positive().max(16_384),
        durationMs: z
          .number()
          .int()
          .positive()
          .max(10 * 60 * 1_000),
        durationToleranceMs: z.number().int().nonnegative().max(30_000),
        framesPerSecond: FilmFrameRateSchema,
        audio: z.enum(['none', 'embedded', 'separate']),
      })
      .strict(),
    continuityNotes: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict()
  .superRefine((clip, context) => {
    if (!dimensionsMatchAspectRatio(clip.outputContract)) {
      context.addIssue({
        code: 'custom',
        path: ['outputContract'],
        message: `Output dimensions must have an exact ${clip.outputContract.aspectRatio} ratio.`,
      });
    }
    if (clip.outputContract.durationMs !== clip.targetDurationMs) {
      context.addIssue({
        code: 'custom',
        path: ['outputContract', 'durationMs'],
        message: 'Output duration must equal targetDurationMs.',
      });
    }
    const validateWindows = (
      windows: Array<{ startMs: number; endMs: number }>,
      path: 'timeline' | 'dialogueWindows',
    ) => {
      let previousEnd = 0;
      windows.forEach((window, index) => {
        if (window.startMs < previousEnd) {
          context.addIssue({
            code: 'custom',
            path: [
              path === 'timeline' ? 'prompt' : path,
              ...(path === 'timeline' ? ['timeline'] : []),
              index,
              'startMs',
            ],
            message: `${path} entries must be ordered and non-overlapping.`,
          });
        }
        if (window.endMs > clip.targetDurationMs) {
          context.addIssue({
            code: 'custom',
            path: [
              path === 'timeline' ? 'prompt' : path,
              ...(path === 'timeline' ? ['timeline'] : []),
              index,
              'endMs',
            ],
            message: `${path} entry exceeds targetDurationMs.`,
          });
        }
        previousEnd = Math.max(previousEnd, window.endMs);
      });
    };
    validateWindows(clip.prompt.timeline, 'timeline');
    validateWindows(clip.dialogueWindows, 'dialogueWindows');
  });
export type FilmClipSpec = z.infer<typeof FilmClipSpecSchema>;

export const FilmTrailerSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4_000).default(''),
    targetDurationMs: z
      .number()
      .int()
      .positive()
      .max(10 * 60 * 1_000),
    generationControl: FilmGenerationControlSchema,
    referenceRoleNotes: z
      .array(
        StoryClipReferenceRoleNoteSchema.extend({
          referenceId: z.string().trim().min(1).max(120),
          note: z.string().trim().min(1).max(2_000),
        }),
      )
      .max(100),
    prompt: z
      .object({
        masterPrompt: z.string().trim().min(1).max(100_000),
        negativeConstraints: z
          .array(z.string().trim().min(1).max(1_000))
          .max(100),
        timeline: z.array(FilmPromptTimelineEntrySchema).min(1).max(200),
      })
      .strict(),
    outputContract: z
      .object({
        aspectRatio: FilmAspectRatioSchema,
        width: z.number().int().positive().max(16_384),
        height: z.number().int().positive().max(16_384),
        durationMs: z
          .number()
          .int()
          .positive()
          .max(10 * 60 * 1_000),
        durationToleranceMs: z.number().int().nonnegative().max(30_000),
        framesPerSecond: FilmFrameRateSchema,
        audio: z.enum(['none', 'embedded', 'separate']),
      })
      .strict(),
    continuityNotes: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict()
  .superRefine((trailer, context) => {
    if (!dimensionsMatchAspectRatio(trailer.outputContract)) {
      context.addIssue({
        code: 'custom',
        path: ['outputContract'],
        message: `Output dimensions must have an exact ${trailer.outputContract.aspectRatio} ratio.`,
      });
    }
    if (trailer.outputContract.durationMs !== trailer.targetDurationMs) {
      context.addIssue({
        code: 'custom',
        path: ['outputContract', 'durationMs'],
        message: 'Output duration must equal targetDurationMs.',
      });
    }
    let previousEndMs = 0;
    trailer.prompt.timeline.forEach((beat, index) => {
      if (beat.startMs < previousEndMs) {
        context.addIssue({
          code: 'custom',
          path: ['prompt', 'timeline', index, 'startMs'],
          message:
            'Trailer timeline entries must be ordered and non-overlapping.',
        });
      }
      if (beat.endMs > trailer.targetDurationMs) {
        context.addIssue({
          code: 'custom',
          path: ['prompt', 'timeline', index, 'endMs'],
          message: 'Trailer timeline entry exceeds targetDurationMs.',
        });
      }
      previousEndMs = Math.max(previousEndMs, beat.endMs);
    });
  });
export type FilmTrailerSpec = z.infer<typeof FilmTrailerSpecSchema>;

function dimensionsMatchAspectRatio(frame: {
  aspectRatio: FilmAspectRatio;
  width: number;
  height: number;
}): boolean {
  return frame.aspectRatio === '16:9'
    ? frame.width * 9 === frame.height * 16
    : frame.width * 16 === frame.height * 9;
}

export const FilmReferenceKindSchema = z.enum([
  'character',
  'location',
  'prop',
  'graphic',
  'style',
  'join_frame',
  'first_frame',
  'last_frame',
]);
export type FilmReferenceKind = z.infer<typeof FilmReferenceKindSchema>;

export const FilmReferenceSlotSpecSchema = z
  .object({
    key: FilmReferenceKeySchema,
    kind: FilmReferenceKindSchema,
    label: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4_000).default(''),
    required: z.boolean(),
    rank: z.number().int().nonnegative().max(100_000),
  })
  .strict();
export type FilmReferenceSlotSpec = z.infer<typeof FilmReferenceSlotSpecSchema>;

export const FilmClipReferenceRoleSchema = z.enum([
  'omni',
  'first_frame',
  'last_frame',
  'continuity',
  'style',
]);
export type FilmClipReferenceRole = z.infer<typeof FilmClipReferenceRoleSchema>;

export const FilmClipReferenceBindingInputSchema = z
  .object({
    referenceSlotId: StoryUuidSchema,
    role: FilmClipReferenceRoleSchema,
    rank: z.number().int().nonnegative().max(1_000),
    required: z.boolean().default(true),
  })
  .strict();
export type FilmClipReferenceBindingInput = z.infer<
  typeof FilmClipReferenceBindingInputSchema
>;

/**
 * Compose a stored Clip's generationControl with proposed bindings and parse
 * this schema before persisting. This is the authoritative Frame/Omni
 * exclusivity check; the request alone cannot validate against stored state.
 */
export const FilmClipReferencePlanSchema = z
  .object({
    generationControl: FilmGenerationControlSchema,
    bindings: z.array(FilmClipReferenceBindingInputSchema).max(50),
  })
  .strict()
  .superRefine((plan, context) => {
    const roles = new Set(plan.bindings.map((binding) => binding.role));
    if (plan.generationControl.mode === 'omni_reference') {
      if (roles.has('first_frame') || roles.has('last_frame')) {
        context.addIssue({
          code: 'custom',
          path: ['bindings'],
          message: 'Omni Reference cannot bind first or last frames.',
        });
      }
      if (!roles.has('omni')) {
        context.addIssue({
          code: 'custom',
          path: ['bindings'],
          message: 'Omni Reference requires at least one omni binding.',
        });
      }
      if (
        !plan.bindings.some(
          (binding) => binding.role === 'omni' && binding.required,
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['bindings'],
          message:
            'Omni Reference requires at least one required omni binding.',
        });
      }
      return;
    }
    if (roles.has('omni')) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message: 'Frame Lock cannot bind Omni references.',
      });
    }
    if (!roles.has('first_frame')) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message: 'Frame Lock requires a first-frame binding.',
      });
    }
    if (
      !plan.bindings.some(
        (binding) => binding.role === 'first_frame' && binding.required,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message: 'Frame Lock requires a required first-frame binding.',
      });
    }
    if (
      plan.generationControl.frameMode === 'first_last_frame' &&
      !roles.has('last_frame')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message: 'First + Last Frame mode requires a last-frame binding.',
      });
    }
    if (
      plan.generationControl.frameMode === 'first_last_frame' &&
      !plan.bindings.some(
        (binding) => binding.role === 'last_frame' && binding.required,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message:
          'First + Last Frame mode requires a required last-frame binding.',
      });
    }
    if (
      plan.generationControl.frameMode === 'first_frame' &&
      roles.has('last_frame')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message: 'First Frame mode cannot bind a last frame.',
      });
    }
  });

export const FilmClipDependencyKindSchema = z.enum([
  'required',
  'continuity',
  'convergence',
]);
export type FilmClipDependencyKind = z.infer<
  typeof FilmClipDependencyKindSchema
>;

export const FilmClipTransitionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct') }).strict(),
  z.object({ kind: z.literal('hidden_cut') }).strict(),
  z
    .object({
      kind: z.literal('shared_join_frame'),
      joinFrameReferenceSlotId: StoryUuidSchema,
    })
    .strict(),
]);
export type FilmClipTransition = z.infer<typeof FilmClipTransitionSchema>;

export const FilmClipDependencySpecSchema = z
  .object({
    predecessorClipId: StoryUuidSchema,
    successorClipId: StoryUuidSchema,
    kind: FilmClipDependencyKindSchema,
    transition: FilmClipTransitionSchema,
  })
  .strict()
  .refine(
    (dependency) => dependency.predecessorClipId !== dependency.successorClipId,
    {
      path: ['successorClipId'],
      message: 'A clip cannot depend on itself.',
    },
  );
export type FilmClipDependencySpec = z.infer<
  typeof FilmClipDependencySpecSchema
>;

export const ReviewChecklistValueSchema = z.enum(['pass', 'fail', 'na']);

export const FilmBuildScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }).strict(),
  z
    .object({
      kind: z.literal('subgraph'),
      entryClipId: StoryUuidSchema,
      maxDepth: z.number().int().positive().max(100).optional(),
    })
    .strict(),
]);
export type FilmBuildScope = z.infer<typeof FilmBuildScopeSchema>;

export const FilmBuildStatusSchema = z.enum([
  'queued',
  'validating',
  'compiling',
  'ready',
  'failed',
  'cancelled',
]);
export type FilmBuildStatus = z.infer<typeof FilmBuildStatusSchema>;

export const FilmReviewDecisionSchema = z.enum([
  'approve',
  'reject',
  'request_changes',
]);
export type FilmReviewDecision = z.infer<typeof FilmReviewDecisionSchema>;
