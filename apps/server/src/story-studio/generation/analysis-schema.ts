/**
 * StoryStudioAnalysis v2 — the wire shape between StoryOS generation and the
 * studio canvas, now carrying the fizzstory 起承转合 act structure.
 *
 * Two validation layers (docs/story-studio-creator-v3-refactor.md §D3):
 *  - LENIENT shape coercion: the model may drift on optional prose fields —
 *    coerce with defaults instead of hard-failing.
 *  - STRICT semantic checks: structural invariants (4 acts, valid genre,
 *    plot→act membership, step budget) return readable errors that drive ONE
 *    repair retry against the model before the request fails.
 */
import {
  ACT_KEYS,
  STORY_GENRE_KEYS,
  TOTAL_STEP_BUDGET,
  type StoryActKey,
  type StoryGenreKey,
} from './act-templates';

export interface StoryActPlan {
  key: StoryActKey;
  anchor: string;
  interactionCount: number;
  stepBudget: number;
  emotionArc: string;
  exitHook: string;
}

export interface StoryStudioAnalysisV2 {
  title: string;
  summary: string;
  worldview: string;
  storyKernel: string;
  adaptationDirection: string;
  genre: StoryGenreKey;
  locations: string[];
  acts: StoryActPlan[];
  protagonist: { name: string; role: string; summary: string };
  characters: Array<{
    name: string;
    role: string;
    summary: string;
    tags: string[];
  }>;
  clues: Array<{
    title: string;
    summary: string;
    type: string;
    source: string;
    use: string;
    rule: string;
    tags: string[];
  }>;
  plots: Array<{
    title: string;
    summary: string;
    entryGoal: string;
    actKey: StoryActKey;
    tags: string[];
  }>;
  endings: Array<{
    title: string;
    type: 'truth' | 'intervention' | 'failure' | 'hidden';
    summary: string;
    trigger: string;
    review: string;
    tags: string[];
  }>;
  guardrails: string[];
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    )
    .map((item) => item.trim())
    .slice(0, 8);
}

function asCount(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function coerceActKey(value: unknown): StoryActKey | null {
  return ACT_KEYS.includes(value as StoryActKey)
    ? (value as StoryActKey)
    : null;
}

function coerceGenre(value: unknown): StoryGenreKey {
  return STORY_GENRE_KEYS.includes(value as StoryGenreKey)
    ? (value as StoryGenreKey)
    : 'suspense';
}

function coerceEndingType(
  value: unknown,
): StoryStudioAnalysisV2['endings'][number]['type'] {
  if (
    value === 'truth' ||
    value === 'intervention' ||
    value === 'failure' ||
    value === 'hidden'
  ) {
    return value;
  }
  return 'truth';
}

/** LENIENT layer — shape the raw model JSON into the v2 analysis. */
export function coerceAnalysisV2(
  raw: JsonRecord,
  fallbackTitle: string,
): StoryStudioAnalysisV2 {
  const protagonist = asRecord(raw.protagonist);
  const characters = Array.isArray(raw.characters) ? raw.characters : [];
  const clues = Array.isArray(raw.clues) ? raw.clues : [];
  const plots = Array.isArray(raw.plots) ? raw.plots : [];
  const endings = Array.isArray(raw.endings) ? raw.endings : [];
  const acts = Array.isArray(raw.acts) ? raw.acts : [];

  return {
    title: asString(raw.title, fallbackTitle),
    summary: asString(
      raw.summary,
      'A playable story draft generated from the creator intake.',
    ),
    worldview: asString(raw.worldview, 'Worldview pending refinement.'),
    storyKernel: asString(
      raw.storyKernel,
      'A central conflict that can become a playable story.',
    ),
    adaptationDirection: asString(raw.adaptationDirection, 'Suspense'),
    genre: coerceGenre(raw.genre),
    locations: asStringArray(raw.locations, ['Opening location']),
    acts: acts.slice(0, 6).flatMap((item) => {
      const record = asRecord(item);
      const key = coerceActKey(record.key);
      if (!key) return [];
      return [
        {
          key,
          anchor: asString(record.anchor, 'Act anchor pending refinement.'),
          interactionCount: asCount(record.interactionCount, 3),
          stepBudget: asCount(record.stepBudget, TOTAL_STEP_BUDGET / 4),
          emotionArc: asString(
            record.emotionArc,
            'Emotion arc pending refinement.',
          ),
          exitHook: asString(record.exitHook, 'Exit hook pending refinement.'),
        },
      ];
    }),
    protagonist: {
      name: asString(protagonist.name, 'Protagonist'),
      role: asString(protagonist.role, 'Player character'),
      summary: asString(
        protagonist.summary,
        'The player-facing point of view character.',
      ),
    },
    characters: characters.slice(0, 5).map((item, index) => {
      const record = asRecord(item);
      return {
        name: asString(record.name, `Character ${index + 1}`),
        role: asString(record.role, 'Story role'),
        summary: asString(
          record.summary,
          'A supporting role for the playable story.',
        ),
        tags: asStringArray(record.tags, ['character']),
      };
    }),
    clues: clues.slice(0, 6).map((item, index) => {
      const record = asRecord(item);
      return {
        title: asString(record.title, `Clue ${index + 1}`),
        summary: asString(
          record.summary,
          'A discoverable fact that can gate later reasoning.',
        ),
        type: asString(record.type, 'evidence'),
        source: asString(record.source, 'Player action'),
        use: asString(
          record.use,
          'Supports later questions, deductions, or story exits.',
        ),
        rule: asString(
          record.rule,
          'Must be discovered before the AI can cite it as known fact.',
        ),
        tags: asStringArray(record.tags, ['clue']),
      };
    }),
    plots: plots.slice(0, 8).map((item, index) => {
      const record = asRecord(item);
      return {
        title: asString(record.title, `Plot Beat ${index + 1}`),
        summary: asString(
          record.summary,
          'A playable phase with an immediate player objective.',
        ),
        entryGoal: asString(
          record.entryGoal,
          'Let the player understand the current situation.',
        ),
        actKey: coerceActKey(record.actKey) ?? 'setup',
        tags: asStringArray(record.tags, ['open action']),
      };
    }),
    endings: endings.slice(0, 4).map((item, index) => {
      const record = asRecord(item);
      return {
        title: asString(record.title, `Ending ${index + 1}`),
        type: coerceEndingType(record.type),
        summary: asString(record.summary, 'A terminal story state.'),
        trigger: asString(
          record.trigger,
          'Reached through a plot exit condition.',
        ),
        review: asString(
          record.review,
          'Summarize the player evidence chain and missed opportunities.',
        ),
        tags: asStringArray(record.tags, ['ending']),
      };
    }),
    guardrails: asStringArray(raw.guardrails, [
      'Do not reveal hidden truth before the player earns the relevant facts.',
    ]),
  };
}

/**
 * STRICT layer — structural invariants. Returns readable violations (empty =
 * valid); the generation service feeds them back to the model for ONE repair
 * retry before giving up.
 */
export function validateAnalysisSemantics(
  analysis: StoryStudioAnalysisV2,
): string[] {
  const errors: string[] = [];

  const actKeys = analysis.acts.map((act) => act.key);
  for (const key of ACT_KEYS) {
    if (!actKeys.includes(key))
      errors.push(`acts must include key "${key}" (起承转合 all four).`);
  }
  if (analysis.acts.length !== ACT_KEYS.length) {
    errors.push(
      `acts must contain exactly ${ACT_KEYS.length} entries, got ${analysis.acts.length}.`,
    );
  }

  const budgetSum = analysis.acts.reduce((sum, act) => sum + act.stepBudget, 0);
  if (Math.abs(budgetSum - TOTAL_STEP_BUDGET) > 20) {
    errors.push(
      `act stepBudget values must sum to roughly ${TOTAL_STEP_BUDGET} (±20), got ${budgetSum}.`,
    );
  }
  for (const act of analysis.acts) {
    if (act.interactionCount < 1 || act.interactionCount > 12) {
      errors.push(
        `act "${act.key}" interactionCount must be between 1 and 12.`,
      );
    }
  }

  if (analysis.plots.length < ACT_KEYS.length) {
    errors.push(
      `plots must contain at least ${ACT_KEYS.length} beats (one per act).`,
    );
  }
  for (const key of ACT_KEYS) {
    if (!analysis.plots.some((plot) => plot.actKey === key)) {
      errors.push(
        `every act needs at least one plot beat — none reference actKey "${key}".`,
      );
    }
  }

  if (analysis.endings.length < 1) {
    errors.push('endings must contain at least one entry.');
  }

  return errors;
}
