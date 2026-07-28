import { z } from 'zod';

/**
 * Interactive-story authoring contracts.
 *
 * A project's format is its preferred creation profile, not a graph
 * restriction. The same strict document is a pure branching tree of cinematic
 * clips and narrative text scenes: each node either continues to one next node,
 * fans into labelled choices, or resolves to an ending, before it is compiled
 * to the shared Runtime Manifest.
 */

export const INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION =
  'interactive-story-draft-v1' as const;

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
/**
 * A localized-text map key, judged exactly as written.
 *
 * Not trimmed, for the same reason `StoryAgentLocaleSchema` is not: these are
 * object KEYS, so trimming rewrites the document — `{" en-US": a, "en-US": b}`
 * parsed to one entry and silently dropped a translation. It also has to agree
 * with the Agent patch contract that writes into this document: a key the patch
 * accepts must be a key the draft accepts, or a valid patch fails its own
 * post-write validation.
 */
export const StoryLocaleSchema = z.string().min(2).max(16);
/** Mutable-draft text may be empty while the creator is still authoring. */
export const DraftLocalizedTextSchema = z.record(
  StoryLocaleSchema,
  z.string().max(4_000),
);
export const StoryTextBodyLocalizedTextSchema = z.record(
  StoryLocaleSchema,
  z.string().max(20_000),
);

export const MAX_CHARACTER_IMAGES = 6;
export const MAX_CHARACTER_VOICE_DURATION_MS = 5_000;
export const MAX_STORY_PROJECT_NODES = 10_000;

export const MAX_CHARACTER_IMAGE_LABEL_LENGTH = 60;

/**
 * One uploaded appearance-reference image (形象图) backing generation. The
 * label names the look (常服 / 夜行 / 盛装 …) so prompts can address it.
 */
export const StoryCharacterImageSchema = z
  .object({
    mediaAssetId: z.string().uuid(),
    url: z.string().trim().min(1).max(2_048),
    label: z.string().trim().min(1).max(MAX_CHARACTER_IMAGE_LABEL_LENGTH),
  })
  .strict();
export type StoryCharacterImage = z.infer<typeof StoryCharacterImageSchema>;

/** Voice-clone reference sample (音色); hard-capped at 5 seconds. */
export const StoryCharacterVoiceSchema = z
  .object({
    mediaAssetId: z.string().uuid(),
    url: z.string().trim().min(1).max(2_048),
    durationMs: z
      .number()
      .int()
      .positive()
      .max(MAX_CHARACTER_VOICE_DURATION_MS),
  })
  .strict();
export type StoryCharacterVoice = z.infer<typeof StoryCharacterVoiceSchema>;

const StoryCharacterObjectSchema = z
  .object({
    id: StoryStableIdSchema,
    name: DraftLocalizedTextSchema,
    summary: z.string().max(4_000),
    images: z
      .array(StoryCharacterImageSchema)
      .max(MAX_CHARACTER_IMAGES)
      .default([]),
    voice: StoryCharacterVoiceSchema.nullable().default(null),
  })
  .strict();

// Drafts written before 2026-07 carried `playable`/`continuityRules`/`role`,
// and briefly stored unlabeled images; normalize them so `.strict()` keeps
// rejecting genuinely unknown keys.
export const StoryCharacterSchema = z.preprocess((value) => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const {
      playable: _playable,
      continuityRules: _rules,
      role: _role,
      ...rest
    } = value as Record<string, unknown>;
    if (Array.isArray(rest.images)) {
      rest.images = rest.images.map((image, index) =>
        image !== null &&
        typeof image === 'object' &&
        !Array.isArray(image) &&
        !(
          typeof (image as Record<string, unknown>).label === 'string' &&
          ((image as Record<string, unknown>).label as string).trim()
        )
          ? { ...(image as Record<string, unknown>), label: `Ref ${index + 1}` }
          : image,
      );
    }
    return rest;
  }
  return value;
}, StoryCharacterObjectSchema);

export const StoryEndingSchema = z
  .object({
    id: StoryStableIdSchema,
    title: DraftLocalizedTextSchema,
    summary: DraftLocalizedTextSchema.optional(),
  })
  .strict();

export const StoryGraphChoiceSchema = z
  .object({
    choiceId: StoryStableIdSchema,
    label: DraftLocalizedTextSchema,
    nextNodeId: StoryStableIdSchema,
  })
  .strict();

const StoryClipAutoExitSchema = z
  .object({
    kind: z.literal('auto'),
    nextNodeId: StoryStableIdSchema.nullable(),
  })
  .strict();

// One choice exit for both clip and text nodes: a decision is just its prompt
// and its labelled choices. When the choice is presented (clip end, text read)
// is derived from the node kind at compile time, not authored per node.
const StoryChoiceExitSchema = z
  .object({
    kind: z.literal('choice'),
    decisionId: StoryStableIdSchema,
    prompt: DraftLocalizedTextSchema,
    choices: z.array(StoryGraphChoiceSchema).max(6),
  })
  .strict();

const StoryEndingExitSchema = z
  .object({
    kind: z.literal('ending'),
    endingId: StoryStableIdSchema,
  })
  .strict();

/**
 * The music track a node asks for, named by the workspace audio MediaAsset the
 * creator attached.
 *
 * Optional and additive: a node without it changes nothing about the music, and
 * every revision authored before music parses unchanged. Binding one asset to
 * several nodes is normal — that is how a theme returns.
 *
 * Nothing downstream may FAIL on this binding. Whether the asset still exists,
 * belongs to the workspace and is audio is answered at compile time by simply
 * resolving a URL: no URL, no music on that scene. Losing a video breaks the
 * story; losing a bed only means silence, so publishing never blocks on it.
 */
export const StoryNodeMusicSchema = z
  .object({ mediaAssetId: z.string().uuid() })
  .strict();
export type StoryNodeMusic = z.infer<typeof StoryNodeMusicSchema>;

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
    music: StoryNodeMusicSchema.optional(),
    exit: z.discriminatedUnion('kind', [
      StoryClipAutoExitSchema,
      StoryChoiceExitSchema,
      StoryEndingExitSchema,
    ]),
  })
  .strict();

const StoryTextGraphNodeSchema = z
  .object({
    kind: z.literal('text'),
    nodeId: StoryStableIdSchema,
    title: DraftLocalizedTextSchema.optional(),
    body: StoryTextBodyLocalizedTextSchema,
    music: StoryNodeMusicSchema.optional(),
    exit: z.discriminatedUnion('kind', [
      StoryClipAutoExitSchema,
      StoryChoiceExitSchema,
      StoryEndingExitSchema,
    ]),
  })
  .strict();

export const StoryGraphNodeSchema = z.discriminatedUnion('kind', [
  StoryClipGraphNodeSchema,
  StoryTextGraphNodeSchema,
]);

/** Mutable graph shape. Referential and completeness checks run on lock. */
export const InteractiveStoryGraphSchema = z
  .object({
    entryNodeId: StoryStableIdSchema.nullable(),
    nodes: z.array(StoryGraphNodeSchema).max(MAX_STORY_PROJECT_NODES),
  })
  .strict();

const InteractiveStoryDraftContentBaseSchema = z
  .object({
    // Drafts written before 2026-07 carried storyRules/locations/props lists;
    // strip them so `.strict()` keeps rejecting genuinely unknown keys.
    storyBible: z.preprocess(
      (value) => {
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value)
        ) {
          const {
            storyRules: _rules,
            locations: _locations,
            props: _props,
            ...rest
          } = value as Record<string, unknown>;
          return rest;
        }
        return value;
      },
      z
        .object({
          logline: z.string().max(1_000),
          synopsis: z.string().max(20_000),
          worldview: z.string().max(20_000),
          characters: z.array(StoryCharacterSchema).max(100),
          endings: z.array(StoryEndingSchema).max(100),
        })
        .strict(),
    ),
    graph: InteractiveStoryGraphSchema,
    productionNotes: z.array(z.string().max(2_000)).max(200),
  })
  .strict();
type InteractiveStoryDraftContentBase = z.infer<
  typeof InteractiveStoryDraftContentBaseSchema
>;

export const InteractiveStoryDraftContentSchema =
  InteractiveStoryDraftContentBaseSchema.superRefine((draft, context) => {
    addDuplicateStableIdentifierIssues(
      draft.storyBible.characters,
      (character) => character.id,
      ['storyBible', 'characters'],
      'id',
      context,
    );
    validateCanonicalDecisionDefinitions(draft, context);
  });
export type InteractiveStoryDraftContent = z.infer<
  typeof InteractiveStoryDraftContentSchema
>;

interface RuntimeLocalizedCopy {
  value: Record<string, string>;
  path: PropertyKey[];
}

export interface InteractiveStoryRuntimeLocaleCoverageIssue {
  locale: string;
  path: PropertyKey[];
}

/**
 * Runtime locales are derived only from copy that ships in the player. World
 * bible metadata (for example a translated character name) must never silently
 * widen the release locale contract.
 */
export function collectInteractiveStoryRuntimeLocales(
  draft: InteractiveStoryDraftContent,
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

export function findInteractiveStoryRuntimeLocaleCoverageIssues(
  draft: InteractiveStoryDraftContent,
  enabledLocales: readonly string[],
): InteractiveStoryRuntimeLocaleCoverageIssue[] {
  return runtimeLocalizedCopies(draft).flatMap((copy) =>
    enabledLocales.flatMap((locale) =>
      copy.value[locale]?.trim()
        ? []
        : [{ locale, path: [...copy.path, locale] }],
    ),
  );
}

function runtimeLocalizedCopies(
  draft: InteractiveStoryDraftContent,
): RuntimeLocalizedCopy[] {
  return [
    ...draft.storyBible.endings.flatMap((ending, endingIndex) => [
      {
        value: ending.title,
        path: ['storyBible', 'endings', endingIndex, 'title'],
      },
      ...(hasNonEmptyLocalizedText(ending.summary)
        ? [
            {
              value: ending.summary,
              path: ['storyBible', 'endings', endingIndex, 'summary'],
            },
          ]
        : []),
    ]),
    ...draft.graph.nodes.flatMap((node, nodeIndex) => {
      const textCopies =
        node.kind === 'text'
          ? [
              ...(hasNonEmptyLocalizedText(node.title)
                ? [
                    {
                      value: node.title,
                      path: ['graph', 'nodes', nodeIndex, 'title'],
                    },
                  ]
                : []),
              {
                value: node.body,
                path: ['graph', 'nodes', nodeIndex, 'body'],
              },
            ]
          : [];
      if (node.exit.kind !== 'choice') return textCopies;
      return [
        ...textCopies,
        {
          value: node.exit.prompt,
          path: ['graph', 'nodes', nodeIndex, 'exit', 'prompt'],
        },
        ...node.exit.choices.map((choice, choiceIndex) => ({
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
        })),
      ];
    }),
  ];
}

function hasNonEmptyLocalizedText(
  value: Record<string, string> | undefined,
): value is Record<string, string> {
  return Boolean(value && Object.values(value).some((text) => text.trim()));
}

export const EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT: InteractiveStoryDraftContent =
  {
    storyBible: {
      logline: '',
      synopsis: '',
      worldview: '',
      characters: [],
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
  draft: InteractiveStoryDraftContentBase,
  context: z.RefinementCtx,
): void {
  type ChoiceExit = z.infer<typeof StoryChoiceExitSchema>;
  const decisions = new Map<
    string,
    { exit: ChoiceExit; nodeId: string; nodeIndex: number }
  >();

  draft.graph.nodes.forEach((node, nodeIndex) => {
    if (node.exit.kind !== 'choice') return;
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
    for (const field of ['label'] as const) {
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

/** Full-story playtest gate for story structure and runtime copy. */
export function createPlayableInteractiveStoryDraftContentSchema(
  defaultLocale?: string,
) {
  const normalizedDefaultLocale = defaultLocale
    ? StoryLocaleSchema.parse(defaultLocale)
    : undefined;
  return InteractiveStoryDraftContentSchema.superRefine((draft, context) => {
    validateInteractiveStoryGameplayReadiness(
      draft,
      context,
      normalizedDefaultLocale,
    );
  });
}

export const PlayableInteractiveStoryDraftContentSchema =
  createPlayableInteractiveStoryDraftContentSchema();

/**
 * Revision-lock gate. PUT /draft intentionally uses the permissive mutable
 * schema above; POST /revisions/lock parses the stored head through this one.
 * This is the immutable full-gameplay boundary for story graph and runtime
 * copy. Clip video selection is independent from the story draft.
 */
export function createLockableInteractiveStoryDraftContentSchema(
  defaultLocale?: string,
) {
  const normalizedDefaultLocale = defaultLocale
    ? StoryLocaleSchema.parse(defaultLocale)
    : undefined;
  return InteractiveStoryDraftContentSchema.superRefine((draft, context) => {
    validateInteractiveStoryGameplayReadiness(
      draft,
      context,
      normalizedDefaultLocale,
    );
  });
}

export const LockableInteractiveStoryDraftContentSchema =
  createLockableInteractiveStoryDraftContentSchema();

function validateInteractiveStoryGameplayReadiness(
  draft: InteractiveStoryDraftContent,
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
  draft.productionNotes.forEach((note, index) =>
    requireText(note, ['productionNotes', index]),
  );

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

  draft.storyBible.characters.forEach((character, index) => {
    requireLocalizedText(character.name, [
      'storyBible',
      'characters',
      index,
      'name',
    ]);
    requireText(character.summary, [
      'storyBible',
      'characters',
      index,
      'summary',
    ]);
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
    if (hasNonEmptyLocalizedText(ending.summary)) {
      requireLocalizedText(ending.summary, [
        'storyBible',
        'endings',
        index,
        'summary',
      ]);
    }
  });

  const enabledLocales = collectInteractiveStoryRuntimeLocales(
    draft,
    defaultLocale,
  );
  findInteractiveStoryRuntimeLocaleCoverageIssues(
    draft,
    enabledLocales,
  ).forEach((issue) => {
    context.addIssue({
      code: 'custom',
      path: issue.path,
      message: `Provide non-empty ${issue.locale} runtime copy.`,
    });
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

  draft.graph.nodes.forEach((node, nodeIndex) => {
    const exitPath: PropertyKey[] = ['graph', 'nodes', nodeIndex, 'exit'];
    if (node.kind === 'text') {
      if (hasNonEmptyLocalizedText(node.title)) {
        requireLocalizedText(node.title, [
          'graph',
          'nodes',
          nodeIndex,
          'title',
        ]);
      }
      requireLocalizedText(node.body, ['graph', 'nodes', nodeIndex, 'body']);
    }
    if (node.exit.kind === 'auto') {
      if (node.exit.nextNodeId === null) {
        context.addIssue({
          code: 'custom',
          path: [...exitPath, 'nextNodeId'],
          message: 'A scene continuation needs a target node.',
        });
      } else if (!nodeIds.has(node.exit.nextNodeId)) {
        context.addIssue({
          code: 'custom',
          path: [...exitPath, 'nextNodeId'],
          message: `Unknown target node ${node.exit.nextNodeId}.`,
        });
      }
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
        if (!nodeIds.has(choice.nextNodeId)) {
          context.addIssue({
            code: 'custom',
            path: [...choicePath, 'nextNodeId'],
            message: `Unknown target node ${choice.nextNodeId}.`,
          });
        }
      });
    }
    if (node.exit.kind === 'ending' && !endingIds.has(node.exit.endingId)) {
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
