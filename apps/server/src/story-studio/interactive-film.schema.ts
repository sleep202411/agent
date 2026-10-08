import {
  STORY_AUTHORING_TEXT_MAX,
  STORY_AUTHORING_DESCRIPTION_MAX,
} from '@repo/shared/story-production';
import { z } from 'zod';
import {
  MAX_STORY_CONDITION_DEPTH,
  MAX_STORY_CONDITION_LEAVES,
  MAX_STORY_EXIT_ROUTES,
  MAX_STORY_STATE_NOTE_LENGTH,
  MAX_STORY_STATE_VARIABLES,
  StoryAutoRoutesSchema,
  StoryConditionSchema,
  StoryEndingKindSchema,
  StoryRouteTargetSchema,
  StoryStateEffectsSchema,
  StoryStateKeySchema,
  StoryStateValueTypeSchema,
  measureStoryCondition,
  migrateStoryDraftStats,
  storyAutoExit,
  storyConditionTypeError,
  storyConditionUsesOnlyKeys,
  storyEffectTypeError,
  storyRouteEndingId,
  type StoryCondition,
  type StoryExitRoute,
  type StoryRouteTarget,
  type StoryStateEffect,
  type StoryStateVariableLookup,
} from '@repo/shared/story-stats';
import { stripRetiredStoryWorldNodes } from '@repo/shared/strip-retired-story-world-nodes';
import { storyPlaybackCopy } from './story-playback-copy';

/**
 * Interactive-story authoring contracts.
 *
 * The strict document is a branching tree of cinematic clips. A clip either
 * continues to one next clip, fans into labelled choices, or ends naturally.
 * This schema accepts cinematic clip graphs only.
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
  z.string().max(STORY_AUTHORING_TEXT_MAX),
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
    const rest = { ...(value as Record<string, unknown>) };
    delete rest.playable;
    delete rest.continuityRules;
    delete rest.role;
    if (Array.isArray(rest.images)) {
      const images: unknown[] = rest.images;
      rest.images = images.map((image, index) =>
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

const StoryCommunityPointPriceSchema = z
  .number()
  .int()
  .min(0)
  .max(2_147_483_647)
  .optional();

export const StoryStateVariableSchema = z
  .object({
    key: StoryStateKeySchema,
    name: DraftLocalizedTextSchema,
    valueType: StoryStateValueTypeSchema,
    initialValue: z.union([z.number().finite(), z.boolean()]),
    note: z.string().max(MAX_STORY_STATE_NOTE_LENGTH).optional(),
  })
  .strict()
  .superRefine((variable, context) => {
    if (typeof variable.initialValue !== variable.valueType) {
      context.addIssue({
        code: 'custom',
        path: ['initialValue'],
        message: `Initial value must match ${variable.valueType}.`,
      });
    }
  });
export type StoryStateVariable = z.infer<typeof StoryStateVariableSchema>;

export const StoryEndingSchema = z
  .object({
    endingId: StoryStableIdSchema,
    title: DraftLocalizedTextSchema,
    kind: StoryEndingKindSchema,
  })
  .strict();
export type StoryEnding = z.infer<typeof StoryEndingSchema>;

export const StoryGraphChoiceSchema = z
  .object({
    choiceId: StoryStableIdSchema,
    label: DraftLocalizedTextSchema,
    effects: StoryStateEffectsSchema.optional(),
    visibleWhen: StoryConditionSchema.optional(),
    target: StoryRouteTargetSchema.nullable(),
  })
  .strict();

export const StoryInteractionActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('continue'),
      effects: StoryStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pause'),
      effects: StoryStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('seek'),
      timeMs: z.number().int().nonnegative(),
      effects: StoryStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('goto'),
      target: StoryRouteTargetSchema,
      effects: StoryStateEffectsSchema.optional(),
    })
    .strict(),
]);
export type StoryInteractionAction = z.infer<
  typeof StoryInteractionActionSchema
>;

export const StoryInteractionTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap') }).strict(),
  z
    .object({
      kind: z.literal('swipe'),
      direction: z.enum(['up', 'down', 'left', 'right']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('press-hold'),
      durationMs: z.number().int().min(300).max(10_000),
      /**
       * Timeline-control charge: the hotspot video pauses when the input
       * window opens and only advances while the pointer is held down, so the
       * media playback position itself is the charge progress. The legacy
       * default keeps judging against wall-clock time while the video plays.
       */
      controlTimeline: z.boolean().default(false),
    })
    .strict(),
]);
export type StoryInteractionTrigger = z.infer<
  typeof StoryInteractionTriggerSchema
>;

export const StoryInteractionOutcomesSchema = z
  .object({
    success: StoryInteractionActionSchema,
    failure: StoryInteractionActionSchema.optional(),
    timeout: StoryInteractionActionSchema.optional(),
  })
  .strict();
export type StoryInteractionOutcomes = z.infer<
  typeof StoryInteractionOutcomesSchema
>;

const StoryInteractionRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .superRefine((rect, context) => {
    if (rect.x + rect.width <= 1 && rect.y + rect.height <= 1) return;
    context.addIssue({
      code: 'custom',
      message: 'Interaction rectangle must remain inside the video frame.',
    });
  });

export const StoryHotspotInteractionSchema = z
  .object({
    kind: z.literal('hotspot'),
    interactionId: StoryStableIdSchema,
    label: DraftLocalizedTextSchema,
    trigger: StoryInteractionTriggerSchema,
    rect: StoryInteractionRectSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    /**
     * Safe branch frame: a resolved interaction keeps playing the current
     * clip until this timestamp before the branch cut lands, so the outgoing
     * pose never jumps. Defaults to the input window end when omitted.
     */
    branchAtMs: z.number().int().positive().optional(),
    /** `window` plays through the range. `hold` pauses at the start until the gesture resolves. */
    timing: z.enum(['window', 'hold']).default('window'),
    outcomes: StoryInteractionOutcomesSchema,
  })
  .strict()
  .superRefine((interaction, context) => {
    if (interaction.endMs > interaction.startMs) return;
    context.addIssue({
      code: 'custom',
      path: ['endMs'],
      message: 'Interaction end must be after its start.',
    });
  })
  .superRefine((interaction, context) => {
    if (interaction.branchAtMs === undefined) return;
    if (interaction.branchAtMs >= interaction.endMs) return;
    context.addIssue({
      code: 'custom',
      path: ['branchAtMs'],
      message: 'Branch frame must not land before the input window closes.',
    });
  });
export type StoryHotspotInteraction = z.infer<
  typeof StoryHotspotInteractionSchema
>;

const StoryClipAutoExitSchema = z
  .object({
    kind: z.literal('auto'),
    routes: StoryAutoRoutesSchema,
  })
  .strict();

// A decision is presented when its clip finishes.
const StoryChoiceExitSchema = z
  .object({
    kind: z.literal('choice'),
    decisionId: StoryStableIdSchema,
    prompt: DraftLocalizedTextSchema,
    choices: z.array(StoryGraphChoiceSchema).max(6),
  })
  .strict();

const StoryClipGraphNodeSchema = z
  .object({
    kind: z.literal('clip'),
    nodeId: StoryStableIdSchema,
    communityPointPrice: StoryCommunityPointPriceSchema,
    clipKey: StoryClipKeySchema,
    // Authoring-only display metadata. clipKey stays the uppercase stable key;
    // these are the human-facing name and description edited in the inspector.
    // Optional so drafts authored before the field parse unchanged.
    name: z.string().trim().max(120).optional(),
    description: z.string().max(STORY_AUTHORING_DESCRIPTION_MAX).optional(),
    interactions: z.array(StoryHotspotInteractionSchema).max(100).default([]),
    onEnterEffects: StoryStateEffectsSchema.optional(),
    exit: z.discriminatedUnion('kind', [
      StoryClipAutoExitSchema,
      StoryChoiceExitSchema,
    ]),
  })
  .strict();

const StoryDecisionGraphNodeSchema = z
  .object({
    kind: z.literal('decision'),
    nodeId: StoryStableIdSchema,
    // Normalized playback snapshots may bypass an unfinished decision. The
    // draft write DTO requires choice here so the editor always retains copy.
    onEnterEffects: StoryStateEffectsSchema.optional(),
    exit: z.discriminatedUnion('kind', [
      StoryClipAutoExitSchema,
      StoryChoiceExitSchema,
    ]),
  })
  .strict();

export const StoryGraphNodeSchema = z.discriminatedUnion('kind', [
  StoryClipGraphNodeSchema,
  StoryDecisionGraphNodeSchema,
]);

/**
 * Mutable graph shape. Referential and completeness checks run on lock.
 * Nodes saved while world cards existed are removed before validation, and
 * the surrounding film is reconnected.
 */
export const InteractiveStoryGraphSchema = z.preprocess(
  (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return value;
    const graph = value as { nodes?: unknown };
    if (
      !Array.isArray(graph.nodes) ||
      !graph.nodes.some(
        (node) =>
          !!node &&
          typeof node === 'object' &&
          (node as { kind?: unknown }).kind === 'world',
      )
    ) {
      return value;
    }
    return stripRetiredStoryWorldNodes({
      graph: value as { entryNodeId: string | null; nodes: [] },
    }).graph;
  },
  z
    .object({
      entryNodeId: StoryStableIdSchema.nullable(),
      nodes: z.array(StoryGraphNodeSchema).max(MAX_STORY_PROJECT_NODES),
    })
    .strict(),
);

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
          const rest = { ...(value as Record<string, unknown>) };
          delete rest.storyRules;
          delete rest.locations;
          delete rest.props;
          return rest;
        }
        return value;
      },
      z
        .object({
          logline: z.string().max(1_000),
          synopsis: z.string().max(20_000),
          characters: z.array(StoryCharacterSchema).max(100),
          stateVariables: z
            .array(StoryStateVariableSchema)
            .max(MAX_STORY_STATE_VARIABLES)
            .optional(),
          endings: z.array(StoryEndingSchema).max(64).optional(),
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

const RefinedInteractiveStoryDraftContentSchema =
  InteractiveStoryDraftContentBaseSchema.superRefine((draft, context) => {
    addDuplicateStableIdentifierIssues(
      draft.storyBible.characters,
      (character) => character.id,
      ['storyBible', 'characters'],
      'id',
      context,
    );
    addDuplicateStableIdentifierIssues(
      draft.storyBible.stateVariables ?? [],
      (variable) => variable.key,
      ['storyBible', 'stateVariables'],
      'key',
      context,
    );
    addDuplicateStableIdentifierIssues(
      draft.storyBible.endings ?? [],
      (ending) => ending.endingId,
      ['storyBible', 'endings'],
      'endingId',
      context,
    );
  });

/**
 * Drafts created before the unified interaction contract stored one `action`
 * and could only describe a tap. Migrate that shape at the document boundary;
 * all authoring, agent and runtime code sees the canonical outcomes model.
 */
export const InteractiveStoryDraftContentSchema = z.preprocess(
  (value) =>
    migrateStoryDraftStats(migrateLegacyStoryInteractionActions(value)),
  RefinedInteractiveStoryDraftContentSchema,
);
export type InteractiveStoryDraftContent = z.infer<
  typeof InteractiveStoryDraftContentSchema
>;

function migrateLegacyStoryInteractionActions(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const draft = value as Record<string, unknown>;
  const graph = draft.graph;
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    return value;
  }
  const nodes = (graph as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return value;

  let changed = false;
  const migratedNodes = nodes.map((node: unknown) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return node;
    }
    const record = node as Record<string, unknown>;
    if (record.kind !== 'clip' || !Array.isArray(record.interactions)) {
      return node;
    }
    const interactions = record.interactions.map((interaction: unknown) => {
      if (
        interaction === null ||
        typeof interaction !== 'object' ||
        Array.isArray(interaction)
      ) {
        return interaction;
      }
      const interactionRecord = interaction as Record<string, unknown>;
      if ('outcomes' in interactionRecord || !('action' in interactionRecord)) {
        return interaction;
      }
      changed = true;
      const { action, ...rest } = interactionRecord;
      return { ...rest, outcomes: { success: action } };
    });
    return interactions === record.interactions
      ? node
      : { ...record, interactions };
  });
  if (!changed) return value;
  return {
    ...draft,
    graph: { ...(graph as Record<string, unknown>), nodes: migratedNodes },
  };
}

interface RuntimeLocalizedCopy {
  value: Record<string, string>;
  path: PropertyKey[];
}

export interface InteractiveStoryRuntimeLocaleCoverageIssue {
  locale: string;
  path: PropertyKey[];
}

/**
 * Runtime locales are derived only from copy that ships in the player. Film
 * foundation metadata (for example a translated character name) must never silently
 * widen the release locale contract.
 */
export function collectInteractiveStoryRuntimeLocales(
  draft: InteractiveStoryDraftContent,
  defaultLocale?: string,
): string[] {
  const copies = runtimeLocalizedCopies(draft);
  const candidates = new Set<string>(defaultLocale ? [defaultLocale] : []);
  copies.forEach((copy) => {
    Object.keys(copy.value).forEach((locale) => candidates.add(locale));
  });
  const ordered = [...candidates]
    .filter((locale) =>
      copies.every((copy) => Boolean(copy.value[locale]?.trim())),
    )
    .sort();
  if (!defaultLocale || !ordered.includes(defaultLocale)) return ordered;
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
    ...(draft.storyBible.stateVariables ?? []).map((variable, index) => ({
      value: variable.name,
      path: ['storyBible', 'stateVariables', index, 'name'],
    })),
    ...(draft.storyBible.endings ?? []).map((ending, index) => ({
      value: ending.title,
      path: ['storyBible', 'endings', index, 'title'],
    })),
    ...draft.graph.nodes.flatMap((node, nodeIndex) => {
      if (node.exit.kind !== 'choice') return [];
      return [
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
  ].filter((copy) =>
    Object.values(copy.value).some((text) => Boolean(text.trim())),
  );
}

export const EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT: InteractiveStoryDraftContent =
  {
    storyBible: {
      logline: '',
      synopsis: '',
      characters: [],
      stateVariables: [],
      endings: [],
    },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };

/** A repeated decision id is shared only while its authored copy still agrees. */
function findDecisionDefinitionConflicts(
  draft: InteractiveStoryDraftContentBase,
): Set<string> {
  type ChoiceExit = z.infer<typeof StoryChoiceExitSchema>;
  const decisions = new Map<string, { exit: ChoiceExit; nodeId: string }>();
  const conflicts = new Set<string>();

  draft.graph.nodes.forEach((node) => {
    if (node.exit.kind !== 'choice') return;
    const canonical = decisions.get(node.exit.decisionId);
    if (!canonical) {
      decisions.set(node.exit.decisionId, {
        exit: node.exit,
        nodeId: node.nodeId,
      });
      return;
    }

    const conflictingField = findDecisionSemanticConflict(
      canonical.exit,
      node.exit,
    );
    if (conflictingField) conflicts.add(node.nodeId);
  });
  return conflicts;
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

  // Routing targets are not part of the canonical decision. The same
  // decision can be presented after alternate predecessor clips whose visual
  // branches continue through different graph nodes or endings.
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
  options: { preserveUnfinishedChoices?: boolean } = {},
) {
  const normalizedDefaultLocale = defaultLocale
    ? StoryLocaleSchema.parse(defaultLocale)
    : undefined;
  return z.preprocess(
    (value) =>
      normalizeInteractiveFilmRuntimeDraft(
        value,
        normalizedDefaultLocale,
        options,
      ),
    InteractiveStoryDraftContentSchema.superRefine((draft, context) => {
      validateInteractiveStoryGameplayReadiness(
        draft,
        context,
        options.preserveUnfinishedChoices ? 1 : 2,
      );
    }),
  );
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
  return z.preprocess(
    (value) =>
      normalizeInteractiveFilmRuntimeDraft(value, normalizedDefaultLocale),
    InteractiveStoryDraftContentSchema.superRefine((draft, context) => {
      validateInteractiveStoryGameplayReadiness(draft, context);
    }),
  );
}

export const LockableInteractiveStoryDraftContentSchema =
  createLockableInteractiveStoryDraftContentSchema();

function validateInteractiveStoryGameplayReadiness(
  draft: InteractiveStoryDraftContent,
  context: z.RefinementCtx,
  minimumChoices = 2,
): void {
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
  const nodeIds = unique(
    draft.graph.nodes,
    (value) => value.nodeId,
    ['graph', 'nodes'],
    'nodeId',
  );
  unique(
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

  const endingIds = unique(
    draft.storyBible.endings ?? [],
    (ending) => ending.endingId,
    ['storyBible', 'endings'],
    'endingId',
  );
  unique(
    draft.storyBible.stateVariables ?? [],
    (variable) => variable.key,
    ['storyBible', 'stateVariables'],
    'key',
  );
  const variables: StoryStateVariableLookup = new Map(
    (draft.storyBible.stateVariables ?? []).map((variable) => [
      variable.key,
      { valueType: variable.valueType },
    ]),
  );
  (draft.storyBible.stateVariables ?? []).forEach((variable, index) => {
    requireLocalizedText(variable.name, [
      'storyBible',
      'stateVariables',
      index,
      'name',
    ]);
  });
  (draft.storyBible.endings ?? []).forEach((ending, index) => {
    requireLocalizedText(ending.title, [
      'storyBible',
      'endings',
      index,
      'title',
    ]);
  });

  const requireTarget = (
    target: StoryRouteTarget | null,
    path: PropertyKey[],
    options: { allowNull: boolean },
  ) => {
    if (target === null) {
      if (!options.allowNull) {
        context.addIssue({
          code: 'custom',
          path,
          message: 'Unknown target node null.',
        });
      }
      return;
    }
    if (target.kind === 'node' && !nodeIds.has(target.nodeId)) {
      context.addIssue({
        code: 'custom',
        path,
        message: `Unknown target node ${target.nodeId}.`,
      });
    }
    if (target.kind === 'ending' && !endingIds.has(target.endingId)) {
      context.addIssue({
        code: 'custom',
        path,
        message: `Unknown ending ${target.endingId}.`,
      });
    }
  };
  const requireEffects = (
    effects: readonly StoryStateEffect[] | undefined,
    path: PropertyKey[],
  ) => {
    effects?.forEach((effect, index) => {
      const error = storyEffectTypeError(effect, variables);
      if (!error) return;
      context.addIssue({
        code: 'custom',
        path: [...path, index],
        message: error,
      });
    });
  };
  const requireCondition = (
    condition: StoryCondition | undefined,
    path: PropertyKey[],
  ) => {
    if (!condition) return;
    const bounds = measureStoryCondition(condition);
    if (bounds.depth > MAX_STORY_CONDITION_DEPTH) {
      context.addIssue({
        code: 'custom',
        path,
        message: `Condition depth must be at most ${MAX_STORY_CONDITION_DEPTH}.`,
      });
    }
    if (bounds.leaves > MAX_STORY_CONDITION_LEAVES) {
      context.addIssue({
        code: 'custom',
        path,
        message: `Condition may contain at most ${MAX_STORY_CONDITION_LEAVES} comparisons.`,
      });
    }
    const error = storyConditionTypeError(condition, variables);
    if (error) {
      context.addIssue({ code: 'custom', path, message: error });
    }
  };
  const requireRoutes = (
    routes: readonly StoryExitRoute[],
    path: PropertyKey[],
  ) => {
    if (routes.length > MAX_STORY_EXIT_ROUTES) {
      context.addIssue({
        code: 'custom',
        path,
        message: `An auto exit may declare at most ${MAX_STORY_EXIT_ROUTES} routes.`,
      });
    }
    const fallbackIndexes = routes.flatMap((route, index) =>
      route.when ? [] : [index],
    );
    if (
      fallbackIndexes.length !== 1 ||
      fallbackIndexes[0] !== routes.length - 1
    ) {
      context.addIssue({
        code: 'custom',
        path,
        message:
          'An auto exit needs exactly one unconditional fallback route, and it must be last.',
      });
    }
    routes.forEach((route, index) => {
      requireCondition(route.when, [...path, index, 'when']);
      requireTarget(route.target, [...path, index, 'target'], {
        allowNull: true,
      });
    });
  };

  draft.graph.nodes.forEach((node, nodeIndex) => {
    const nodePath: PropertyKey[] = ['graph', 'nodes', nodeIndex];
    const exitPath: PropertyKey[] = [...nodePath, 'exit'];
    requireEffects(node.onEnterEffects, [...nodePath, 'onEnterEffects']);
    if (node.kind === 'clip') {
      node.interactions.forEach((interaction, interactionIndex) => {
        const outcomesPath = [
          ...nodePath,
          'interactions',
          interactionIndex,
          'outcomes',
        ];
        Object.entries(interaction.outcomes).forEach(([outcome, action]) => {
          if (!action) return;
          requireEffects(action.effects, [...outcomesPath, outcome, 'effects']);
          if (action.kind === 'goto') {
            requireTarget(action.target, [...outcomesPath, outcome, 'target'], {
              allowNull: false,
            });
          }
        });
      });
    }
    if (node.exit.kind === 'auto') {
      requireRoutes(node.exit.routes, [...exitPath, 'routes']);
      return;
    }
    // The question above the options may be blank. Option labels stay required.
    if (node.exit.choices.length < minimumChoices) {
      context.addIssue({
        code: 'custom',
        path: [...exitPath, 'choices'],
        message: `A choice exit needs at least ${minimumChoices} choices.`,
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
      requireEffects(choice.effects, [...choicePath, 'effects']);
      requireCondition(choice.visibleWhen, [...choicePath, 'visibleWhen']);
      requireTarget(choice.target, [...choicePath, 'target'], {
        allowNull: false,
      });
    });
  });
}

export type InteractiveStoryStatsLint = {
  code: 'ORPHAN_ENDING' | 'ALL_CHOICES_CONDITIONAL';
  path: PropertyKey[];
  message: string;
};

export function lintInteractiveStoryStats(
  draft: InteractiveStoryDraftContent,
): InteractiveStoryStatsLint[] {
  const referencedEndings = new Set<string>();
  const noteEnding = (target: StoryRouteTarget | null | undefined) => {
    const endingId = storyRouteEndingId(target);
    if (endingId) referencedEndings.add(endingId);
  };
  draft.graph.nodes.forEach((node) => {
    if (node.exit.kind === 'auto') {
      node.exit.routes.forEach((route) => noteEnding(route.target));
    } else {
      node.exit.choices.forEach((choice) => noteEnding(choice.target));
    }
    if (node.kind !== 'clip') return;
    node.interactions.forEach((interaction) => {
      Object.values(interaction.outcomes).forEach((action) => {
        if (action?.kind === 'goto') noteEnding(action.target);
      });
    });
  });
  const issues: InteractiveStoryStatsLint[] = [];
  (draft.storyBible.endings ?? []).forEach((ending, index) => {
    if (referencedEndings.has(ending.endingId)) return;
    issues.push({
      code: 'ORPHAN_ENDING',
      path: ['storyBible', 'endings', index, 'endingId'],
      message: `Ending ${ending.endingId} is never routed to.`,
    });
  });
  draft.graph.nodes.forEach((node, nodeIndex) => {
    if (node.exit.kind !== 'choice' || node.exit.choices.length === 0) return;
    if (!node.exit.choices.every((choice) => choice.visibleWhen)) return;
    issues.push({
      code: 'ALL_CHOICES_CONDITIONAL',
      path: ['graph', 'nodes', nodeIndex, 'exit', 'choices'],
      message:
        'Every choice is gated by visibleWhen; playtest the branch so a hidden decision cannot stall.',
    });
  });
  return issues;
}

/**
 * Turns the permissive canvas document into the exact runtime document.
 *
 * Film clips are the only production requirement. A half-authored branch is
 * canvas metadata, not a reason to block release: until at least two labelled,
 * connected options are present, playback follows the first connected route
 * (or ends on the current clip). A blank question does not drop the other
 * options. Invalid automatic routes are likewise treated as terminal. Working
 * previews preserve unfinished choices with default copy and terminal routes.
 * The saved draft is never rewritten.
 */
function normalizeInteractiveFilmRuntimeDraft(
  value: unknown,
  defaultLocale?: string,
  options: { preserveUnfinishedChoices?: boolean } = {},
): unknown {
  const parsed = InteractiveStoryDraftContentSchema.safeParse(value);
  if (!parsed.success) return value;

  const draft = parsed.data;
  const nodeIds = new Set(draft.graph.nodes.map((node) => node.nodeId));
  const endingIds = new Set(
    (draft.storyBible.endings ?? []).map((ending) => ending.endingId),
  );
  const variableKeys = new Set(
    (draft.storyBible.stateVariables ?? []).map((variable) => variable.key),
  );
  const isConnectedTarget = (target: StoryRouteTarget | null): boolean => {
    if (!target) return false;
    if (target.kind === 'node') return nodeIds.has(target.nodeId);
    return endingIds.has(target.endingId);
  };
  const keepEffects = (effects?: StoryStateEffect[]) => {
    const kept = effects?.filter((effect) => variableKeys.has(effect.key));
    return kept && kept.length > 0 ? kept : undefined;
  };
  const keepCondition = (condition?: StoryCondition) =>
    condition && storyConditionUsesOnlyKeys(condition, variableKeys)
      ? condition
      : undefined;
  const normalizeRoutes = (
    routes: readonly StoryExitRoute[],
  ): StoryExitRoute[] => {
    const kept = routes.flatMap((route) => {
      const when = keepCondition(route.when);
      if (route.when && !when) return [];
      if (route.when && !isConnectedTarget(route.target)) return [];
      return [
        {
          ...(when ? { when } : {}),
          target: isConnectedTarget(route.target) ? route.target : null,
        },
      ];
    });
    const conditionals = kept.filter((route) => route.when);
    const fallback = [...kept].reverse().find((route) => !route.when) ?? {
      target: null,
    };
    return [...conditionals, { target: fallback.target }];
  };
  // A missing translation is not a gameplay failure. The player already uses
  // same-language, project-default, then first-available copy fallback. Keep
  // that one runtime rule here as well so a perfectly playable branch is not
  // silently flattened merely because its default-locale translation is still
  // being authored.
  const hasCopy = (copy: Record<string, string>) =>
    Object.values(copy).some((text) => Boolean(text.trim()));
  const runtimeLocale = defaultLocale ?? 'en-US';
  const previewCopy = storyPlaybackCopy(runtimeLocale);
  const previewLocalizedCopy = (
    copy: Record<string, string>,
    fallback: string,
  ): Record<string, string> => {
    const entries = Object.entries(copy).filter(([, text]) => text.trim());
    const language = runtimeLocale.split('-')[0];
    const preferred =
      entries.find(([locale]) => locale === runtimeLocale) ??
      entries.find(([locale]) => locale.split('-')[0] === language) ??
      entries[0];
    return {
      ...Object.fromEntries(entries),
      [runtimeLocale]: preferred?.[1] ?? fallback,
    };
  };
  // Unconnected preview options explicitly end their path. This runtime-only
  // terminal keeps the strict wire contract intact without editing the draft.
  let previewTerminalId = 'preview:unconnected-end';
  let previewTerminalSuffix = 1;
  while (nodeIds.has(previewTerminalId))
    previewTerminalId = `preview:unconnected-end-${previewTerminalSuffix++}`;
  let needsPreviewTerminal = false;

  const normalizeInteractions = (
    interactions: StoryHotspotInteraction[],
  ): StoryHotspotInteraction[] => {
    const seenInteractionIds = new Set<string>();
    return interactions.flatMap((interaction, interactionIndex) => {
      if (seenInteractionIds.has(interaction.interactionId)) return [];
      seenInteractionIds.add(interaction.interactionId);

      const normalizeAction = (
        action: StoryInteractionAction | undefined,
        required: boolean,
      ): StoryInteractionAction | undefined => {
        if (!action) return required ? { kind: 'continue' } : undefined;
        const effects = keepEffects(action.effects);
        const next =
          effects === action.effects ? action : { ...action, effects };
        if (action.kind !== 'goto' || isConnectedTarget(action.target)) {
          return next;
        }
        return required
          ? { kind: 'continue', ...(effects ? { effects } : {}) }
          : undefined;
      };
      const label = Object.fromEntries(
        Object.entries(interaction.label).flatMap(([locale, copy]) => {
          const trimmed = copy.trim();
          return trimmed ? [[locale, trimmed]] : [];
        }),
      );
      const failure = normalizeAction(interaction.outcomes.failure, false);
      const timeout = normalizeAction(interaction.outcomes.timeout, false);

      return [
        {
          ...interaction,
          label:
            Object.keys(label).length > 0
              ? label
              : {
                  [runtimeLocale]: `Interaction ${interactionIndex + 1}`,
                },
          outcomes: {
            success:
              normalizeAction(interaction.outcomes.success, true) ??
              ({ kind: 'continue' } as const),
            ...(failure ? { failure } : {}),
            ...(timeout ? { timeout } : {}),
          },
        },
      ];
    });
  };

  const normalizedNodes = draft.graph.nodes.map((node) => {
    const onEnterEffects = keepEffects(node.onEnterEffects);
    const normalizedNode = {
      ...node,
      ...(onEnterEffects ? { onEnterEffects } : {}),
      ...(node.kind === 'clip'
        ? { interactions: normalizeInteractions(node.interactions) }
        : {}),
    };
    if (!onEnterEffects) {
      delete (normalizedNode as { onEnterEffects?: StoryStateEffect[] })
        .onEnterEffects;
    }
    if (normalizedNode.exit.kind === 'auto') {
      return {
        ...normalizedNode,
        exit: {
          kind: 'auto' as const,
          routes: normalizeRoutes(normalizedNode.exit.routes),
        },
      };
    }

    const normalizeChoice = (
      choice: (typeof normalizedNode.exit.choices)[number],
      index: number,
      options: { fillLabel?: boolean; previewTarget?: StoryRouteTarget } = {},
    ) => {
      const effects = keepEffects(choice.effects);
      const visibleWhen = keepCondition(choice.visibleWhen);
      const next = {
        ...choice,
        label: options.fillLabel
          ? previewLocalizedCopy(
              choice.label,
              `${previewCopy.option} ${index + 1}`,
            )
          : choice.label,
        target: isConnectedTarget(choice.target)
          ? choice.target
          : (options.previewTarget ?? null),
      };
      if (effects) next.effects = effects;
      else delete next.effects;
      if (visibleWhen) next.visibleWhen = visibleWhen;
      else delete next.visibleWhen;
      return next;
    };

    if (
      options.preserveUnfinishedChoices &&
      normalizedNode.exit.kind === 'choice' &&
      normalizedNode.exit.choices.length > 0
    ) {
      return {
        ...normalizedNode,
        exit: {
          ...normalizedNode.exit,
          prompt: previewLocalizedCopy(
            normalizedNode.exit.prompt,
            previewCopy.prompt,
          ),
          choices: normalizedNode.exit.choices.map((choice, index) => {
            const connected = isConnectedTarget(choice.target);
            if (!connected) needsPreviewTerminal = true;
            return normalizeChoice(choice, index, {
              fillLabel: true,
              previewTarget: connected
                ? undefined
                : { kind: 'node', nodeId: previewTerminalId },
            });
          }),
        },
      };
    }

    const connectedChoices = normalizedNode.exit.choices.filter((choice) =>
      isConnectedTarget(choice.target),
    );
    const branchIsComplete =
      connectedChoices.length >= 2 &&
      connectedChoices.length === normalizedNode.exit.choices.length &&
      connectedChoices.every((choice) => hasCopy(choice.label));
    if (branchIsComplete) {
      return {
        ...normalizedNode,
        exit: {
          ...normalizedNode.exit,
          choices: normalizedNode.exit.choices.map((choice, index) =>
            normalizeChoice(choice, index),
          ),
        },
      };
    }

    return {
      ...normalizedNode,
      exit: {
        kind: 'auto' as const,
        routes: [{ target: connectedChoices[0]?.target ?? null }],
      },
    };
  }) as InteractiveStoryDraftContent['graph']['nodes'];

  if (needsPreviewTerminal) {
    normalizedNodes.push({
      kind: 'decision',
      nodeId: previewTerminalId,
      exit: storyAutoExit(null),
    });
  }

  // Reusing a decision id is useful when two predecessor clips present the
  // same authored choice. If those copies drift while editing, saving must not
  // fail. Give only the conflicting runtime copy a fresh deterministic id; the
  // mutable canvas keeps the creator's exact draft untouched.
  const conflictNodeIds = findDecisionDefinitionConflicts({
    ...draft,
    graph: { ...draft.graph, nodes: normalizedNodes },
  });
  const usedDecisionIds = new Set(
    normalizedNodes.flatMap((node) =>
      node.exit.kind === 'choice' ? [node.exit.decisionId] : [],
    ),
  );
  let generatedDecisionIndex = 1;
  const runtimeNodes = normalizedNodes.map((node) => {
    if (node.exit.kind !== 'choice' || !conflictNodeIds.has(node.nodeId)) {
      return node;
    }
    let decisionId = `decision-${generatedDecisionIndex++}`;
    while (usedDecisionIds.has(decisionId)) {
      decisionId = `decision-${generatedDecisionIndex++}`;
    }
    usedDecisionIds.add(decisionId);
    return { ...node, exit: { ...node.exit, decisionId } };
  });
  const referencedEndingIds = new Set<string>();
  for (const node of runtimeNodes) {
    const targets =
      node.exit.kind === 'choice'
        ? node.exit.choices.map((choice) => choice.target)
        : node.exit.routes.map((route) => route.target);
    for (const target of targets) {
      const endingId = storyRouteEndingId(target);
      if (endingId) referencedEndingIds.add(endingId);
    }
  }

  return {
    ...draft,
    storyBible: {
      ...draft.storyBible,
      ...(draft.storyBible.stateVariables
        ? {
            stateVariables: draft.storyBible.stateVariables.map((variable) => ({
              ...variable,
              name: hasCopy(variable.name)
                ? previewLocalizedCopy(variable.name, variable.key)
                : variable.name,
            })),
          }
        : {}),
      ...(draft.storyBible.endings
        ? {
            endings: draft.storyBible.endings
              .filter((ending) => referencedEndingIds.has(ending.endingId))
              .map((ending) => ({
                ...ending,
                title: hasCopy(ending.title)
                  ? previewLocalizedCopy(ending.title, ending.endingId)
                  : ending.title,
              })),
          }
        : {}),
    },
    graph: {
      entryNodeId:
        draft.graph.entryNodeId && nodeIds.has(draft.graph.entryNodeId)
          ? draft.graph.entryNodeId
          : (draft.graph.nodes[0]?.nodeId ?? null),
      nodes: runtimeNodes,
    },
  } satisfies InteractiveStoryDraftContent;
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
