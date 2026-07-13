import type { FilmCondition, InteractiveFilmDraftContent } from "@/lib/story-projects-api";

type StoryCharacter = InteractiveFilmDraftContent["storyBible"]["characters"][number];
type StoryStateVariable = InteractiveFilmDraftContent["storyBible"]["stateVariables"][number];

const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/u;
const MAX_STABLE_ID_LENGTH = 120;
const MAX_LOCALE_LENGTH = 16;
const MAX_LOCALIZED_TEXT_LENGTH = 4_000;
const MAX_CHARACTER_ROLE_LENGTH = 160;
const MAX_CHARACTER_SUMMARY_LENGTH = 4_000;
const MAX_CONTINUITY_RULES = 50;
const MAX_CONTINUITY_RULE_LENGTH = 1_000;
const MAX_SCALAR_STRING_LENGTH = 2_000;
const MAX_ALLOWED_VALUES = 100;
const MAX_CHARACTERS = 100;
const MAX_STATE_VARIABLES = 200;

export type StoryWorldTextField = "locations" | "props" | "storyRules";

const WORLD_TEXT_LIMITS: Record<
  StoryWorldTextField,
  { maximumItems: number; maximumLength: number }
> = {
  locations: { maximumItems: 200, maximumLength: 500 },
  props: { maximumItems: 200, maximumLength: 500 },
  storyRules: { maximumItems: 100, maximumLength: 2_000 },
};

export type StoryWorldMutationErrorCode =
  | "INVALID_STABLE_ID"
  | "INVALID_LOCALE"
  | "DUPLICATE_CHARACTER_ID"
  | "CHARACTER_LIMIT_REACHED"
  | "CHARACTER_NOT_FOUND"
  | "CHARACTER_REFERENCED"
  | "INVALID_CHARACTER"
  | "WORLD_TEXT_LIMIT_REACHED"
  | "WORLD_TEXT_INDEX_OUT_OF_RANGE"
  | "INVALID_WORLD_TEXT"
  | "DUPLICATE_STATE_VARIABLE_KEY"
  | "STATE_VARIABLE_LIMIT_REACHED"
  | "STATE_VARIABLE_NOT_FOUND"
  | "STATE_VARIABLE_REFERENCED"
  | "STATE_VARIABLE_KEY_IMMUTABLE"
  | "INVALID_STATE_VARIABLE";

export class StoryWorldMutationError extends Error {
  constructor(
    readonly code: StoryWorldMutationErrorCode,
    message: string,
    readonly referenceCount?: number
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
  content: InteractiveFilmDraftContent;
  created: T;
}

export type StoryCharacterPatch = Partial<
  Pick<StoryCharacter, "name" | "role" | "summary" | "playable" | "continuityRules">
>;

export function createStoryCharacter(
  content: InteractiveFilmDraftContent,
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
    role: "",
    summary: "",
    playable: false,
    continuityRules: [],
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
  content: InteractiveFilmDraftContent,
  characterId: string,
  patch: StoryCharacterPatch
): InteractiveFilmDraftContent {
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
    role: hasOwn(patch, "role") ? patch.role! : current.role,
    summary: hasOwn(patch, "summary") ? patch.summary! : current.summary,
    playable: hasOwn(patch, "playable") ? patch.playable! : current.playable,
    continuityRules: hasOwn(patch, "continuityRules")
      ? patch.continuityRules!
      : current.continuityRules,
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

export function countCharacterReferences(
  content: InteractiveFilmDraftContent,
  characterId: string
): number {
  let count = 0;
  visitGraphConditions(content, (condition) => {
    if (condition.kind === "relationship-at-least" && condition.characterId === characterId) {
      count += 1;
    }
  });
  for (const node of content.graph.nodes) {
    if (node.exit.kind !== "choice") continue;
    for (const choice of node.exit.choices) {
      for (const effect of choice.effects) {
        if (effect.kind === "adjust_relationship" && effect.characterId === characterId) {
          count += 1;
        }
      }
    }
  }
  return count;
}

export function deleteStoryCharacter(
  content: InteractiveFilmDraftContent,
  characterId: string
): InteractiveFilmDraftContent {
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
  const referenceCount = countCharacterReferences(content, characterId);
  if (referenceCount > 0) {
    throw mutationError(
      "CHARACTER_REFERENCED",
      `Character ${characterId} is referenced ${referenceCount} time(s).`,
      referenceCount
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

export function addWorldTextItem(
  content: InteractiveFilmDraftContent,
  field: StoryWorldTextField,
  value: string
): InteractiveFilmDraftContent {
  const limits = WORLD_TEXT_LIMITS[field];
  const items = content.storyBible[field];
  if (items.length >= limits.maximumItems) {
    throw mutationError(
      "WORLD_TEXT_LIMIT_REACHED",
      `${field} may contain at most ${limits.maximumItems} items.`
    );
  }
  const validValue = assertWorldText(field, value);
  return replaceWorldTextItems(content, field, [...items, validValue]);
}

export function updateWorldTextItem(
  content: InteractiveFilmDraftContent,
  field: StoryWorldTextField,
  index: number,
  value: string
): InteractiveFilmDraftContent {
  const items = content.storyBible[field];
  assertWorldTextIndex(field, items, index);
  const validValue = assertWorldText(field, value);
  if (items[index] === validValue) return content;
  return replaceWorldTextItems(
    content,
    field,
    items.map((item, itemIndex) => (itemIndex === index ? validValue : item))
  );
}

export function removeWorldTextItem(
  content: InteractiveFilmDraftContent,
  field: StoryWorldTextField,
  index: number
): InteractiveFilmDraftContent {
  const items = content.storyBible[field];
  assertWorldTextIndex(field, items, index);
  return replaceWorldTextItems(
    content,
    field,
    items.filter((_item, itemIndex) => itemIndex !== index)
  );
}

export interface CreateStoryStateVariableOptions {
  type: StoryStateVariable["type"];
  key?: string;
}

export function createStoryStateVariable(
  content: InteractiveFilmDraftContent,
  options: CreateStoryStateVariableOptions
): StoryWorldCreationResult<StoryStateVariable> {
  if (content.storyBible.stateVariables.length >= MAX_STATE_VARIABLES) {
    throw mutationError(
      "STATE_VARIABLE_LIMIT_REACHED",
      `A story may contain at most ${MAX_STATE_VARIABLES} state variables.`
    );
  }
  assertStateVariableType(options.type);
  const existingKeys = content.storyBible.stateVariables.map((variable) => variable.key);
  const key =
    options.key === undefined
      ? allocateStableId(
          existingKeys,
          `state:${options.type}-${content.storyBible.stateVariables.length + 1}`
        )
      : assertAvailableStateVariableKey(content, options.key);
  const created: StoryStateVariable =
    options.type === "boolean"
      ? { key, type: "boolean", initialValue: false }
      : options.type === "number"
        ? { key, type: "number", initialValue: 0 }
        : { key, type: "string", initialValue: "" };
  return {
    content: {
      ...content,
      storyBible: {
        ...content.storyBible,
        stateVariables: [...content.storyBible.stateVariables, created],
      },
    },
    created,
  };
}

export function replaceStoryStateVariable(
  content: InteractiveFilmDraftContent,
  key: string,
  next: StoryStateVariable
): InteractiveFilmDraftContent {
  const variableIndex = content.storyBible.stateVariables.findIndex(
    (variable) => variable.key === key
  );
  if (variableIndex < 0) {
    throw mutationError("STATE_VARIABLE_NOT_FOUND", `Unknown state variable ${key}.`);
  }
  if (next.key !== key) {
    throw mutationError(
      "STATE_VARIABLE_KEY_IMMUTABLE",
      `State variable key ${key} cannot be changed to ${next.key}.`
    );
  }
  validateStateVariable(next);
  const current = content.storyBible.stateVariables[variableIndex]!;
  if (JSON.stringify(current) === JSON.stringify(next)) return content;
  return {
    ...content,
    storyBible: {
      ...content.storyBible,
      stateVariables: content.storyBible.stateVariables.map((variable, index) =>
        index === variableIndex ? next : variable
      ),
    },
  };
}

export function countStateVariableReferences(
  content: InteractiveFilmDraftContent,
  key: string
): number {
  let count = 0;
  visitGraphConditions(content, (condition) => {
    if (condition.kind === "variable" && condition.key === key) count += 1;
  });
  for (const node of content.graph.nodes) {
    if (node.exit.kind !== "choice") continue;
    for (const choice of node.exit.choices) {
      for (const effect of choice.effects) {
        if (
          (effect.kind === "set_variable" || effect.kind === "increment_variable") &&
          effect.key === key
        ) {
          count += 1;
        }
      }
    }
  }
  return count;
}

export function deleteStoryStateVariable(
  content: InteractiveFilmDraftContent,
  key: string
): InteractiveFilmDraftContent {
  const matchingVariables = content.storyBible.stateVariables.filter(
    (variable) => variable.key === key
  );
  if (matchingVariables.length === 0) {
    throw mutationError("STATE_VARIABLE_NOT_FOUND", `Unknown state variable ${key}.`);
  }
  if (matchingVariables.length > 1) {
    throw mutationError(
      "DUPLICATE_STATE_VARIABLE_KEY",
      `Cannot delete state variable ${key}: the draft contains ${matchingVariables.length} matching keys.`
    );
  }
  const referenceCount = countStateVariableReferences(content, key);
  if (referenceCount > 0) {
    throw mutationError(
      "STATE_VARIABLE_REFERENCED",
      `State variable ${key} is referenced ${referenceCount} time(s).`,
      referenceCount
    );
  }
  return {
    ...content,
    storyBible: {
      ...content.storyBible,
      stateVariables: content.storyBible.stateVariables.filter((variable) => variable.key !== key),
    },
  };
}

function visitGraphConditions(
  content: InteractiveFilmDraftContent,
  visitor: (condition: FilmCondition) => void
): void {
  const visit = (condition: FilmCondition) => {
    visitor(condition);
    if (condition.kind === "all" || condition.kind === "any") {
      condition.conditions.forEach(visit);
    } else if (condition.kind === "not") {
      visit(condition.condition);
    }
  };

  for (const node of content.graph.nodes) {
    if (node.exit.kind === "auto") {
      node.exit.routes.forEach((route) => {
        if (route.when) visit(route.when);
      });
    } else if (node.exit.kind === "choice") {
      node.exit.choices.forEach((choice) => {
        if (choice.visibleWhen) visit(choice.visibleWhen);
      });
    }
  }
}

function validateCharacter(character: StoryCharacter): void {
  assertStableId(character.id);
  validateLocalizedText(character.name, "character name");
  if (typeof character.role !== "string" || character.role.length > MAX_CHARACTER_ROLE_LENGTH) {
    invalidCharacter(`Character role may contain at most ${MAX_CHARACTER_ROLE_LENGTH} characters.`);
  }
  if (
    typeof character.summary !== "string" ||
    character.summary.length > MAX_CHARACTER_SUMMARY_LENGTH
  ) {
    invalidCharacter(
      `Character summary may contain at most ${MAX_CHARACTER_SUMMARY_LENGTH} characters.`
    );
  }
  if (typeof character.playable !== "boolean") {
    invalidCharacter("Character playable must be boolean.");
  }
  if (!Array.isArray(character.continuityRules)) {
    invalidCharacter("Character continuityRules must be an array.");
  }
  if (character.continuityRules.length > MAX_CONTINUITY_RULES) {
    invalidCharacter(`A character may have at most ${MAX_CONTINUITY_RULES} continuity rules.`);
  }
  character.continuityRules.forEach((rule) => {
    if (typeof rule !== "string" || !rule.trim() || rule.length > MAX_CONTINUITY_RULE_LENGTH) {
      invalidCharacter(
        `Continuity rules must be non-empty and at most ${MAX_CONTINUITY_RULE_LENGTH} characters.`
      );
    }
  });
}

function validateStateVariable(variable: StoryStateVariable): void {
  if (!variable || typeof variable !== "object") {
    invalidStateVariable("State variable must be an object.");
  }
  assertStateVariableType(variable.type);
  assertStableId(variable.key);
  if (variable.type === "boolean") {
    assertOnlyKeys(variable, ["key", "type", "initialValue"]);
    if (typeof variable.initialValue !== "boolean") invalidStateVariable("Invalid boolean value.");
    return;
  }
  if (variable.type === "number") {
    assertOnlyKeys(variable, ["key", "type", "initialValue", "minimum", "maximum"]);
    if (!Number.isFinite(variable.initialValue))
      invalidStateVariable("Initial value must be finite.");
    if (variable.minimum !== undefined && !Number.isFinite(variable.minimum)) {
      invalidStateVariable("Minimum must be finite.");
    }
    if (variable.maximum !== undefined && !Number.isFinite(variable.maximum)) {
      invalidStateVariable("Maximum must be finite.");
    }
    return;
  }
  assertOnlyKeys(variable, ["key", "type", "initialValue", "allowedValues"]);
  if (
    typeof variable.initialValue !== "string" ||
    variable.initialValue.length > MAX_SCALAR_STRING_LENGTH
  ) {
    invalidStateVariable(
      `String initial value may contain at most ${MAX_SCALAR_STRING_LENGTH} characters.`
    );
  }
  if (variable.allowedValues !== undefined) {
    if (!Array.isArray(variable.allowedValues)) {
      invalidStateVariable("allowedValues must be an array.");
    }
    if (variable.allowedValues.length < 1 || variable.allowedValues.length > MAX_ALLOWED_VALUES) {
      invalidStateVariable(`allowedValues must contain between 1 and ${MAX_ALLOWED_VALUES} items.`);
    }
    variable.allowedValues.forEach((value) => {
      if (typeof value !== "string" || value.length > MAX_SCALAR_STRING_LENGTH) {
        invalidStateVariable(
          `Allowed values may contain at most ${MAX_SCALAR_STRING_LENGTH} characters.`
        );
      }
    });
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
  content: InteractiveFilmDraftContent,
  characterId: string
): string {
  const valid = assertStableId(characterId);
  if (content.storyBible.characters.some((character) => character.id === valid)) {
    throw mutationError("DUPLICATE_CHARACTER_ID", `Character ${valid} already exists.`);
  }
  return valid;
}

function assertAvailableStateVariableKey(
  content: InteractiveFilmDraftContent,
  key: string
): string {
  const valid = assertStableId(key);
  if (content.storyBible.stateVariables.some((variable) => variable.key === valid)) {
    throw mutationError("DUPLICATE_STATE_VARIABLE_KEY", `State variable ${valid} already exists.`);
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

function assertWorldText(field: StoryWorldTextField, value: string): string {
  if (typeof value !== "string" || value.length > WORLD_TEXT_LIMITS[field].maximumLength) {
    throw mutationError(
      "INVALID_WORLD_TEXT",
      `${field} values may contain at most ${WORLD_TEXT_LIMITS[field].maximumLength} characters.`
    );
  }
  return value;
}

function assertWorldTextIndex(field: StoryWorldTextField, items: string[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw mutationError("WORLD_TEXT_INDEX_OUT_OF_RANGE", `Index ${index} is outside ${field}.`);
  }
}

function replaceWorldTextItems(
  content: InteractiveFilmDraftContent,
  field: StoryWorldTextField,
  items: string[]
): InteractiveFilmDraftContent {
  return {
    ...content,
    storyBible: { ...content.storyBible, [field]: items },
  };
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

function assertStateVariableType(
  value: StoryStateVariable["type"]
): asserts value is StoryStateVariable["type"] {
  if (value !== "boolean" && value !== "number" && value !== "string") {
    invalidStateVariable(`Unsupported state variable type ${String(value)}.`);
  }
}

function assertOnlyKeys(value: object, allowedKeys: string[]): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    invalidStateVariable(`Unexpected state variable field ${unknownKey}.`);
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

function invalidStateVariable(message: string): never {
  throw mutationError("INVALID_STATE_VARIABLE", message);
}

function mutationError(
  code: StoryWorldMutationErrorCode,
  message: string,
  referenceCount?: number
): StoryWorldMutationError {
  return new StoryWorldMutationError(code, message, referenceCount);
}
