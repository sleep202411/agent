import {
  STORY_DIRECTING_SKILL_KEYS,
  STORY_DIRECTING_SKILL_KEY,
  type StoryDirectingSkillKey,
} from '@repo/shared';

/**
 * Model-facing instructions are server-owned. UI labels remain localized in
 * Studio and stable wire keys remain in @repo/shared.
 */
export const STORY_DIRECTING_SKILL_INSTRUCTIONS = Object.freeze({
  [STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK]:
    'Shape the story with deliberate symmetry, chapter-like visual motifs, controlled palettes, centered compositions, dry tonal contrast, and precise reveals. Keep character choices emotionally consequential rather than treating the aesthetic as decoration.',
  [STORY_DIRECTING_SKILL_KEY.INTIMATE_REALISM]:
    'Prioritize restrained performances, natural light, lived-in spaces, observational detail, subtext, and plausible cause-and-effect. Let interactive choices expose relationships and values instead of manufacturing spectacle.',
  [STORY_DIRECTING_SKILL_KEY.EASTERN_DREAMSCAPE]:
    'Use poetic natural imagery, negative space, seasonal or cyclical motifs, layered dream logic, and fluid transitions between memory and reality. Ground cultural details in the supplied story context and avoid generic exoticism.',
  [STORY_DIRECTING_SKILL_KEY.PSYCHOLOGICAL_MYSTERY]:
    'Build controlled ambiguity through subjective point of view, recurring motifs, fair information withholding, escalating contradictions, and reveals that reframe earlier scenes. Choices should change what the player trusts, notices, or is willing to risk.',
  [STORY_DIRECTING_SKILL_KEY.RETRO_FUTURE_NOIR]:
    'Combine analog futurism, shadow geometry, industrial texture, restrained neon, institutional pressure, and morally compromised decisions. Make technology part of the dramatic conflict, not merely production design.',
  [STORY_DIRECTING_SKILL_KEY.HANDCRAFTED_FABLE]:
    'Favor tactile materials, visible craft, practical imperfections, simple archetypal shapes, visual transformation, and emotional clarity. Keep the fable accessible while allowing player choices to complicate its apparent moral.',
} satisfies Readonly<Record<StoryDirectingSkillKey, string>>);

const STORY_DIRECTING_SKILL_KEY_SET = new Set<string>(
  STORY_DIRECTING_SKILL_KEYS,
);

export interface StoryCanvasCopilotInput {
  selectedSkillKeys: StoryDirectingSkillKey[];
}

export class StoryCanvasCopilotInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryCanvasCopilotInputError';
  }
}

/**
 * Validate and normalize Story Canvas-only request fields. Invalid client
 * state fails loudly rather than silently dropping an unknown creative skill.
 */
export function parseStoryCanvasCopilotInput(input: {
  selectedSkillKeys?: unknown;
}): StoryCanvasCopilotInput {
  const rawSkillKeys = input.selectedSkillKeys ?? [];
  if (!Array.isArray(rawSkillKeys)) {
    throw new StoryCanvasCopilotInputError(
      'selectedSkillKeys must be an array.',
    );
  }
  if (rawSkillKeys.length > 1) {
    throw new StoryCanvasCopilotInputError(
      'selectedSkillKeys accepts at most one directing skill.',
    );
  }

  const selectedSkillKeys: StoryDirectingSkillKey[] = [];
  const seen = new Set<string>();
  for (const [index, rawKey] of rawSkillKeys.entries()) {
    if (
      typeof rawKey !== 'string' ||
      !STORY_DIRECTING_SKILL_KEY_SET.has(rawKey)
    ) {
      throw new StoryCanvasCopilotInputError(
        `selectedSkillKeys contains an unsupported value at index ${index}.`,
      );
    }
    if (seen.has(rawKey)) {
      throw new StoryCanvasCopilotInputError(
        `Duplicate Story Canvas directing skill: ${rawKey}.`,
      );
    }
    seen.add(rawKey);
    selectedSkillKeys.push(rawKey as StoryDirectingSkillKey);
  }

  return { selectedSkillKeys };
}
