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
  [STORY_DIRECTING_SKILL_KEY.HALFTONE_COLLAGE]:
    'Render every scene as editorial paper collage: flat single-color paper fields, black-and-white halftone photo cutouts with visible print dots, selective colored cardstock accents that carry information hierarchy (never decoration), crisp cut edges, cream keylines, soft paper shadows, fine uncoated-paper grain. Compress each beat into ONE visual metaphor built from 3-6 key objects with generous negative space, and pick the field color by semantic intent instead of defaulting to a single hue. Motion is assemble-from-empty: pieces slide and snap from a blank color field into the final composition — never drift, shake, or zoom — and typography, logos, glossy 3D, and photorealistic environments are forbidden. Keep the collage language serving the interactive story: each assembly should visualize what the player’s choice changes.',
  [STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK]:
    'Shape the story with deliberate symmetry, chapter-like visual motifs, controlled palettes, centered compositions, dry tonal contrast, and precise reveals. Keep character choices emotionally consequential rather than treating the aesthetic as decoration.',
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
