import type { AssetRecord } from "@/src/types/workspace";
import type { Asset } from "@/src/store/slices/projectSlice";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;
export const PAGE_SIZE = 20;
export const ROLE_RECORD_COLUMN_ID = -1;
export const ROLE_THREE_VIEW_COLUMN_ID = -11;

export type CharacterPanelItem = Asset & {
  __panelKey: string;
  __source: "world" | "asset";
  aliases: string[];
  description: string;
  prompt: string;
  aiId: string;
  roleImgPath: string[];
  otherImgPath: Record<string, string>;
  referenceImgPath: string[];
  referenceImgDescription: string[];
  voiceId: string;
  model: string;
  threeViewsImagePath: string;
};

export type CharacterFormState = {
  id: string;
  aiId: string;
  name: string;
  description: string;
  prompt: string;
  voiceModelCode: string;
  voiceId: string;
  roleImgPath: string[];
  otherImgPath: Record<string, string>;
  referenceImgPath: string[];
  referenceImgDescription: string[];
  threeViewsImagePath: string;
};

export function ossUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

export function normalizeStoragePath(path?: string | null) {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  const prefix = `${OSS_BASE}/`;
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  return raw;
}

export function toArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function parseStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function parseObjectSafely(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed ?? {})
          .map(([key, item]) => [String(key), String(item ?? "").trim()])
          .filter(([, item]) => item)
      );
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [String(key), String(item ?? "").trim()])
        .filter(([, item]) => item)
    );
  }
  return {};
}

export function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCharacterName(value: unknown) {
  return normalizeText(value);
}

export function normalizeCharacterKey(value: unknown) {
  return normalizeCharacterName(value).toLowerCase();
}

export function isMeaningfulCharacterText(input: unknown, characterName = "") {
  const text = normalizeText(input);
  const name = normalizeText(characterName);
  if (!text) return false;
  if (name && text === name) return false;
  return text.length > 8;
}

export function pickPreferredCharacterText(
  currentValue: unknown,
  nextValue: unknown,
  characterName = ""
) {
  const current = normalizeText(currentValue);
  const next = normalizeText(nextValue);
  if (!next) return current;
  if (!current) return next;

  const currentMeaningful = isMeaningfulCharacterText(current, characterName);
  const nextMeaningful = isMeaningfulCharacterText(next, characterName);
  if (!currentMeaningful && nextMeaningful) return next;
  if (!nextMeaningful && currentMeaningful) return current;
  if (next.length > current.length) return next;
  return current;
}

export function buildCharacterMatchKeys(character: Partial<CharacterPanelItem>) {
  return [character.aiId, character.id, character.name, ...(character.aliases ?? [])]
    .map((item) => normalizeCharacterKey(item))
    .filter(Boolean);
}

export function matchesKeyword(character: CharacterPanelItem, keyword: string) {
  const normalizedKeyword = normalizeCharacterKey(keyword);
  if (!normalizedKeyword) return true;
  return [character.name, character.description, character.prompt, ...character.aliases].some(
    (item) => normalizeCharacterKey(item).includes(normalizedKeyword)
  );
}

export function normalizeCharacter(
  character: Asset | Record<string, unknown> | null | undefined,
  index = 0
) {
  const raw = character ?? {};
  const name = normalizeCharacterName(raw.name ?? raw.character_name ?? raw.characterName);
  const otherImgPath = parseObjectSafely(raw.otherImgPath);
  const id = String(raw.id ?? "").trim();
  const aiId = String(raw.aiId ?? raw.character_id ?? raw.characterId ?? "").trim();

  return {
    ...(raw as Asset),
    id,
    name,
    aliases: parseStringList(raw.aliases),
    description: pickPreferredCharacterText(raw.description, raw.description, name),
    prompt: pickPreferredCharacterText(raw.prompt, raw.prompt, name),
    aiId,
    roleImgPath: toArray(raw.roleImgPath)
      .map((item) => normalizeStoragePath(String(item ?? "")))
      .filter(Boolean),
    otherImgPath,
    referenceImgPath: toArray(raw.referenceImgPath)
      .map((item) => normalizeStoragePath(String(item ?? "")))
      .filter(Boolean),
    referenceImgDescription: toArray(raw.referenceImgDescription).map((item) => String(item ?? "")),
    voiceId: String(raw.voiceId ?? "").trim(),
    model: String(raw.model ?? "").trim(),
    threeViewsImagePath: normalizeStoragePath(String(raw.threeViewsImagePath ?? "")),
    __source: id ? "world" : "asset",
    __panelKey: id ? `world:${id}` : `asset:${aiId || normalizeCharacterKey(name) || index}`,
  } satisfies CharacterPanelItem;
}

export function readAssetLibraryCharacters(input: Record<string, unknown> | null | undefined) {
  const candidates = [
    input,
    (input?.assetLibrary as Record<string, unknown> | undefined) ?? null,
    (input?.data as Record<string, unknown> | undefined) ?? null,
    (input?.data as { assetLibrary?: Record<string, unknown> } | undefined)?.assetLibrary ?? null,
  ];
  for (const candidate of candidates) {
    if (candidate && Array.isArray(candidate.character_library)) {
      return candidate.character_library as Asset[];
    }
  }
  return [];
}

export function mergeCharacters(
  worldCharacters: CharacterPanelItem[],
  assetCharacters: CharacterPanelItem[],
  keyword: string
) {
  const merged: CharacterPanelItem[] = [];
  const indexMap = new Map<string, number>();

  const pushCharacter = (character: CharacterPanelItem) => {
    const matchKeys = buildCharacterMatchKeys(character);
    const existingKey = matchKeys.find((key) => indexMap.has(key));
    if (!existingKey) {
      const nextIndex = merged.length;
      merged.push(character);
      matchKeys.forEach((key) => indexMap.set(key, nextIndex));
      return;
    }

    const targetIndex = indexMap.get(existingKey);
    if (targetIndex === undefined) return;

    const current = merged[targetIndex];
    const next: CharacterPanelItem = {
      ...current,
      ...character,
      aliases: current.aliases.length ? current.aliases : character.aliases,
      description: pickPreferredCharacterText(
        current.description,
        character.description,
        character.name || current.name
      ),
      prompt: pickPreferredCharacterText(
        current.prompt,
        character.prompt,
        character.name || current.name
      ),
      roleImgPath: current.roleImgPath.length ? current.roleImgPath : character.roleImgPath,
      otherImgPath: Object.keys(current.otherImgPath).length
        ? current.otherImgPath
        : character.otherImgPath,
      referenceImgPath: current.referenceImgPath.length
        ? current.referenceImgPath
        : character.referenceImgPath,
      referenceImgDescription: current.referenceImgDescription.length
        ? current.referenceImgDescription
        : character.referenceImgDescription,
      aiId: current.aiId || character.aiId,
      __source: current.id ? "world" : character.id ? "world" : current.__source,
      threeViewsImagePath: current.threeViewsImagePath || character.threeViewsImagePath,
      voiceId: current.voiceId || character.voiceId,
      model: current.model || character.model,
    };
    merged[targetIndex] = next;
    buildCharacterMatchKeys(next).forEach((key) => indexMap.set(key, targetIndex));
  };

  worldCharacters.forEach(pushCharacter);
  assetCharacters.forEach(pushCharacter);

  return merged.filter((item) => matchesKeyword(item, keyword));
}

export function getRecordPath(record: AssetRecord) {
  return normalizeStoragePath(
    String(record.storagePath ?? record.path ?? record.filePath ?? record.url ?? "")
  );
}
