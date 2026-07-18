import { z } from 'zod';

/**
 * Interactive-film authoring contracts.
 *
 * These schemas describe creator-owned inputs, not the compiled player
 * manifest. Builds must emit the shared InteractiveFilmReleaseSchema v1;
 * authoring DTOs deliberately do not duplicate runtime media records.
 */

export const INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION =
  'interactive-film-draft-v3' as const;

export const StoryUuidSchema = z.string().uuid();
export const StoryStableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, 'Use a stable identifier.');
export const StoryClipKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_-]*$/, 'Use an uppercase stable clip key.');
export const StoryReferenceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_-]*$/, 'Use an uppercase stable reference key.');
export const StoryLocaleSchema = z.string().trim().min(2).max(16);
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
            reactionClipKey: StoryClipKeySchema,
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
    prompt: DraftLocalizedTextSchema,
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
    clipKey: StoryClipKeySchema,
    // Authoring-only display metadata. clipKey stays the uppercase stable key;
    // these are the human-facing name and description edited in the inspector.
    // Optional so drafts authored before the field parse unchanged.
    name: z.string().trim().max(120).optional(),
    description: z.string().trim().max(4_000).optional(),
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
 * representation without inventing another clip record or video asset.
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
    productionNotes: z.array(z.string().max(2_000)).max(200),
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
  });
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
    productionNotes: [],
  };

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

/** Full-story playtest gate for story structure and runtime copy. */
export function createPlayableInteractiveFilmDraftContentSchema(
  defaultLocale?: string,
) {
  const normalizedDefaultLocale = defaultLocale
    ? StoryLocaleSchema.parse(defaultLocale)
    : undefined;
  return InteractiveFilmDraftContentSchema.superRefine((draft, context) => {
    validateInteractiveFilmGameplayReadiness(
      draft,
      context,
      normalizedDefaultLocale,
    );
  });
}

export const PlayableInteractiveFilmDraftContentSchema =
  createPlayableInteractiveFilmDraftContentSchema();

/**
 * Revision-lock gate. PUT /draft intentionally uses the permissive mutable
 * schema above; POST /revisions/lock parses the stored head through this one.
 * This is the immutable full-gameplay boundary for story graph and runtime
 * copy. Video selection and generation are independent from the story draft.
 */
export function createLockableInteractiveFilmDraftContentSchema(
  defaultLocale?: string,
) {
  const normalizedDefaultLocale = defaultLocale
    ? StoryLocaleSchema.parse(defaultLocale)
    : undefined;
  return InteractiveFilmDraftContentSchema.superRefine((draft, context) => {
    validateInteractiveFilmGameplayReadiness(
      draft,
      context,
      normalizedDefaultLocale,
    );
  });
}

export const LockableInteractiveFilmDraftContentSchema =
  createLockableInteractiveFilmDraftContentSchema();

function validateInteractiveFilmGameplayReadiness(
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

export const StoryReferenceKindSchema = z.enum([
  'character',
  'location',
  'prop',
  'graphic',
  'style',
  'join_frame',
  'first_frame',
  'last_frame',
]);
export type StoryReferenceKind = z.infer<typeof StoryReferenceKindSchema>;

export const StoryReferenceSlotSpecSchema = z
  .object({
    key: StoryReferenceKeySchema,
    kind: StoryReferenceKindSchema,
    label: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4_000).default(''),
    required: z.boolean(),
    rank: z.number().int().nonnegative().max(100_000),
  })
  .strict();
export type StoryReferenceSlotSpec = z.infer<
  typeof StoryReferenceSlotSpecSchema
>;

export const ReviewChecklistValueSchema = z.enum(['pass', 'fail', 'na']);

export const StoryBuildScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }).strict(),
  z
    .object({
      kind: z.literal('subgraph'),
      entryNodeId: StoryStableIdSchema,
      maxDepth: z.number().int().positive().max(100).optional(),
    })
    .strict(),
]);
export type StoryBuildScope = z.infer<typeof StoryBuildScopeSchema>;

export const StoryBuildStatusSchema = z.enum([
  'queued',
  'validating',
  'compiling',
  'ready',
  'failed',
  'cancelled',
]);
export type StoryBuildStatus = z.infer<typeof StoryBuildStatusSchema>;

export const StoryReferenceReviewDecisionSchema = z.enum([
  'approve',
  'reject',
  'request_changes',
]);
export type StoryReferenceReviewDecision = z.infer<
  typeof StoryReferenceReviewDecisionSchema
>;
