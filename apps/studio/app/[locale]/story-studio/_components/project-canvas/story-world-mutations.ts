import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";

type StoryCharacter = InteractiveStoryDraftContent["storyBible"]["characters"][number];

const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/u;
const MAX_STABLE_ID_LENGTH = 120;
const MAX_LOCALE_LENGTH = 16;
const MAX_LOCALIZED_TEXT_LENGTH = 4_000;
const MAX_CHARACTER_SUMMARY_LENGTH = 4_000;
const MAX_IMAGE_LABEL_LENGTH = 60;
const MAX_CHARACTER_IMAGES = 6;
const MAX_CHARACTER_VOICE_DURATION_MS = 5_000;
const MAX_MEDIA_URL_LENGTH = 2_048;
const MAX_CHARACTERS = 100;

export type StoryWorldMutationErrorCode =
  | "INVALID_STABLE_ID"
  | "INVALID_LOCALE"
  | "DUPLICATE_CHARACTER_ID"
  | "CHARACTER_LIMIT_REACHED"
  | "CHARACTER_NOT_FOUND"
  | "INVALID_CHARACTER"
  | "CLIP_NODE_NOT_FOUND";

export class StoryWorldMutationError extends Error {
  constructor(
    readonly code: StoryWorldMutationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StoryWorldMutationError";
  }
}

export interface CreateStoryCharacterOptions {
  locale: string;
  id?: string;
}

export interface StoryWorldCreationResult<T> {
  content: InteractiveStoryDraftContent;
  created: T;
}

export type StoryCharacterPatch = Partial<
  Pick<StoryCharacter, "name" | "summary" | "images" | "voice">
>;

export function createStoryCharacter(
  content: InteractiveStoryDraftContent,
  options: CreateStoryCharacterOptions
): StoryWorldCreationResult<StoryCharacter> {
  if (content.storyBible.characters.length >= MAX_CHARACTERS) {
    throw mutationError(
      "CHARACTER_LIMIT_REACHED",
      `A story may contain at most ${MAX_CHARACTERS} characters.`
    );
  }
  const locale = assertLocale(options.locale);
  const existingIds = content.storyBible.characters.map((character) => character.id);
  const id =
    options.id === undefined
      ? allocateStableId(existingIds, `character:${content.storyBible.characters.length + 1}`)
      : assertAvailableCharacterId(content, options.id);
  const created: StoryCharacter = {
    id,
    name: { [locale]: "" },
    summary: "",
    images: [],
    voice: null,
  };
  return {
    content: {
      ...content,
      storyBible: {
        ...content.storyBible,
        characters: [...content.storyBible.characters, created],
      },
    },
    created,
  };
}

export function updateStoryCharacter(
  content: InteractiveStoryDraftContent,
  characterId: string,
  patch: StoryCharacterPatch
): InteractiveStoryDraftContent {
  const characterIndex = content.storyBible.characters.findIndex(
    (character) => character.id === characterId
  );
  if (characterIndex < 0) {
    throw mutationError("CHARACTER_NOT_FOUND", `Unknown story character ${characterId}.`);
  }
  const current = content.storyBible.characters[characterIndex]!;
  const updated: StoryCharacter = {
    id: current.id,
    name: hasOwn(patch, "name") ? patch.name! : current.name,
    summary: hasOwn(patch, "summary") ? patch.summary! : current.summary,
    images: hasOwn(patch, "images") ? patch.images! : current.images,
    voice: hasOwn(patch, "voice") ? patch.voice! : current.voice,
  };
  validateCharacter(updated);
  if (characterEquals(current, updated)) return content;

  return {
    ...content,
    storyBible: {
      ...content.storyBible,
      characters: content.storyBible.characters.map((character, index) =>
        index === characterIndex ? updated : character
      ),
    },
  };
}

/**
 * A pure branching tree carries no conditions or effects, so a character is
 * never referenced by the executable graph — deletion is always allowed.
 */
export function deleteStoryCharacter(
  content: InteractiveStoryDraftContent,
  characterId: string
): InteractiveStoryDraftContent {
  const matchingCharacters = content.storyBible.characters.filter(
    (character) => character.id === characterId
  );
  if (matchingCharacters.length === 0) {
    throw mutationError("CHARACTER_NOT_FOUND", `Unknown story character ${characterId}.`);
  }
  if (matchingCharacters.length > 1) {
    throw mutationError(
      "DUPLICATE_CHARACTER_ID",
      `Cannot delete character ${characterId}: the draft contains ${matchingCharacters.length} matching identifiers.`
    );
  }
  return {
    ...content,
    storyBible: {
      ...content.storyBible,
      characters: content.storyBible.characters.filter((character) => character.id !== characterId),
    },
  };
}

/**
 * Update a clip node's authoring display metadata (human name + description).
 * clipKey is the stable machine key and is never touched here.
 */
export function updateStoryClipMeta(
  content: InteractiveStoryDraftContent,
  nodeId: string,
  patch: { name?: string; description?: string }
): InteractiveStoryDraftContent {
  let found = false;
  const nodes = content.graph.nodes.map((node) => {
    if (node.kind !== "clip" || node.nodeId !== nodeId) return node;
    found = true;
    return { ...node, ...patch };
  });
  if (!found) {
    throw mutationError("CLIP_NODE_NOT_FOUND", `Unknown clip node ${nodeId}.`);
  }
  return { ...content, graph: { ...content.graph, nodes } };
}

function validateCharacter(character: StoryCharacter): void {
  assertStableId(character.id);
  validateLocalizedText(character.name, "character name");
  if (
    typeof character.summary !== "string" ||
    character.summary.length > MAX_CHARACTER_SUMMARY_LENGTH
  ) {
    invalidCharacter(
      `Character summary may contain at most ${MAX_CHARACTER_SUMMARY_LENGTH} characters.`
    );
  }
  if (!Array.isArray(character.images)) {
    invalidCharacter("Character images must be an array.");
  }
  if (character.images.length > MAX_CHARACTER_IMAGES) {
    invalidCharacter(`A character may have at most ${MAX_CHARACTER_IMAGES} reference images.`);
  }
  character.images.forEach((image) => {
    if (
      !image ||
      typeof image !== "object" ||
      typeof image.mediaAssetId !== "string" ||
      !image.mediaAssetId.trim() ||
      typeof image.url !== "string" ||
      !image.url.trim() ||
      image.url.length > MAX_MEDIA_URL_LENGTH
    ) {
      invalidCharacter("Character images must reference an uploaded media asset.");
    }
    if (
      typeof image.label !== "string" ||
      !image.label.trim() ||
      image.label.length > MAX_IMAGE_LABEL_LENGTH
    ) {
      invalidCharacter(
        `Each character image needs a label of at most ${MAX_IMAGE_LABEL_LENGTH} characters.`
      );
    }
  });
  if (character.voice !== null) {
    const voice = character.voice;
    if (
      !voice ||
      typeof voice !== "object" ||
      typeof voice.mediaAssetId !== "string" ||
      !voice.mediaAssetId.trim() ||
      typeof voice.url !== "string" ||
      !voice.url.trim() ||
      voice.url.length > MAX_MEDIA_URL_LENGTH
    ) {
      invalidCharacter("Character voice must reference an uploaded media asset.");
    }
    if (
      typeof voice.durationMs !== "number" ||
      !Number.isInteger(voice.durationMs) ||
      voice.durationMs <= 0 ||
      voice.durationMs > MAX_CHARACTER_VOICE_DURATION_MS
    ) {
      invalidCharacter(
        `Character voice sample must be at most ${MAX_CHARACTER_VOICE_DURATION_MS / 1000} seconds.`
      );
    }
  }
}

function validateLocalizedText(value: Record<string, string>, field: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidCharacter(`${field} must be a locale-to-text record.`);
  }
  for (const [locale, text] of Object.entries(value)) {
    assertLocale(locale);
    if (typeof text !== "string" || text.length > MAX_LOCALIZED_TEXT_LENGTH) {
      invalidCharacter(
        `${field} values may contain at most ${MAX_LOCALIZED_TEXT_LENGTH} characters.`
      );
    }
  }
}

function assertAvailableCharacterId(
  content: InteractiveStoryDraftContent,
  characterId: string
): string {
  const valid = assertStableId(characterId);
  if (content.storyBible.characters.some((character) => character.id === valid)) {
    throw mutationError("DUPLICATE_CHARACTER_ID", `Character ${valid} already exists.`);
  }
  return valid;
}

function assertStableId(value: string): string {
  if (typeof value !== "string") {
    throw mutationError("INVALID_STABLE_ID", "Stable identifiers must be strings.");
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_STABLE_ID_LENGTH ||
    !STABLE_ID_PATTERN.test(normalized)
  ) {
    throw mutationError("INVALID_STABLE_ID", `Invalid stable identifier ${value}.`);
  }
  return normalized;
}

function assertLocale(value: string): string {
  if (typeof value !== "string") {
    throw mutationError("INVALID_LOCALE", "Story locales must be strings.");
  }
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > MAX_LOCALE_LENGTH) {
    throw mutationError("INVALID_LOCALE", `Invalid story locale ${value}.`);
  }
  return normalized;
}

function allocateStableId(existing: string[], preferred: string): string {
  const ids = new Set(existing);
  const validPreferred = assertStableId(preferred);
  if (!ids.has(validPreferred)) return validPreferred;
  let suffix = 2;
  while (true) {
    const suffixText = `-${suffix}`;
    const candidate = `${validPreferred.slice(0, MAX_STABLE_ID_LENGTH - suffixText.length)}${suffixText}`;
    if (!ids.has(candidate)) return candidate;
    suffix += 1;
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function characterEquals(left: StoryCharacter, right: StoryCharacter): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalidCharacter(message: string): never {
  throw mutationError("INVALID_CHARACTER", message);
}

function mutationError(
  code: StoryWorldMutationErrorCode,
  message: string
): StoryWorldMutationError {
  return new StoryWorldMutationError(code, message);
}
