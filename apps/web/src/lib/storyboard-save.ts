import { backendApi, type Paginated } from "@/src/lib/api";
import type { Asset, ShotColumn, ShotRow, ShotValue } from "@/src/store/slices/projectSlice";
import { env } from "@/src/env";

export type StoryboardTableData = {
  headers: string[];
  rows: string[][];
};

type StoryboardFieldResolver = {
  headerName: string;
  columnIndex: number;
};

type StoryboardImportedRow = {
  rowIndex: number;
  shotNo: string;
  normalizedShotNo: string;
  scene: string;
  description: string;
  imagePrompt: string;
  videoPrompt: string;
  stylePlanting: string;
  signature: string;
};

type StoryboardPersistedRow = {
  shotId: string;
  shotNo: string;
  normalizedShotNo: string;
  scene: string;
  characterIds: string[];
  propIds: string[];
  description: string;
  imagePrompt: string;
  videoPrompt: string;
  stylePlanting: string;
  signature: string;
};

type StoryboardBackfillState = {
  attemptedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failedRows: number[];
  errorMessage: string;
};

type StoryboardBackfillSummary = StoryboardBackfillState & {
  scene: StoryboardBackfillState;
  character: StoryboardBackfillState;
  prop: StoryboardBackfillState;
  imagePrompt: StoryboardBackfillState;
  stylePlanting: StoryboardBackfillState;
  autoload: {
    attemptedCount: number;
    successCount: number;
    failedCount: number;
    failedColumns: string[];
    errorMessage: string;
  };
};

type MentionEntry = {
  id: string;
  type: "character" | "scene" | "prop";
  name: string;
  imgUrl?: string;
  voiceId?: string;
  model?: string;
};

type StoryboardFieldResolvers = Record<
  | "shot_no"
  | "scene"
  | "character"
  | "costume"
  | "prop"
  | "description"
  | "image_prompt"
  | "video_prompt"
  | "style_planting"
  | "movement"
  | "dialogue"
  | "shot_size"
  | "perspective"
  | "duration"
  | "narration",
  StoryboardFieldResolver | null
>;

type StoryboardEntityBackfillRow = {
  rowIndex: number;
  characterIds: string[];
  propIds: string[];
};

const OSS_BASE = env.OSS_BASE_URL;
const STORYBOARD_SAVE_FIELD_ORDER = [
  "shot_no",
  "scene",
  "description",
  "image_prompt",
  "video_prompt",
  "style_planting",
  "movement",
  "dialogue",
  "shot_size",
  "perspective",
  "duration",
] as const;
const STORYBOARD_BACKFILL_SIGNATURE_FIELDS = [
  "shot_no",
  "video_prompt",
  "dialogue",
  "style_planting",
  "movement",
  "shot_size",
  "perspective",
  "duration",
] as const;
const STORYBOARD_EMPTY_ROW_FIELD_KEYS = [
  "shot_no",
  "scene",
  "description",
  "image_prompt",
  "video_prompt",
  "style_planting",
  "dialogue",
  "movement",
] as const;
const STORYBOARD_QUERY_PAGE_SIZE = 100;
const STORYBOARD_QUERY_MAX_PAGES = 50;
const WORLD_PAGE_SIZE = 100;
const WORLD_MAX_PAGES = 20;
const EXISTING_MENTION_PATTERN = /<mention\s+[^>]*>[\s\S]*?<\/mention>/g;
const STORYBOARD_AUTOLOAD_COLUMN_NAME_SET = new Set(["角色", "场景", "道具", "服装"]);
const STORYBOARD_NONE_VALUE_SET = new Set([
  "无",
  "无。",
  "无道具",
  "无角色",
  "无场景",
  "none",
  "null",
  "n/a",
  "na",
  "-",
  "--",
  "暂无",
]);
const STORYBOARD_NARRATION_HEADERS = ["旁白", "narration"];
const STORYBOARD_FIELD_HEADER_PRIORITY_MAP: Record<string, string[]> = {
  shot_no: ["shot_no", "镜号", "鏡號", "Shot No.", "Shot No", "shot"],
  scene: ["scene", "场景", "场景名", "场景名称", "Scene"],
  character: ["character", "角色", "人物", "角色名", "Character"],
  costume: ["costume", "服装", "服饰", "造型", "Costume"],
  prop: ["prop", "props", "道具", "Props", "Prop"],
  description: ["description", "画面描述", "图片描述"],
  image_prompt: ["image_prompt", "Image_Prompt", "图片提示词", "图片Prompt", "图片提示"],
  video_prompt: ["video_prompt", "视频提示词", "视频描述", "视频提示", "Video_Prompt"],
  style_planting: ["style_planting", "画风"],
  movement: ["movement", "运动", "运镜方式"],
  dialogue: ["dialogue", "台词", "对白"],
  shot_size: ["shot_size", "景别"],
  perspective: ["perspective", "角度", "视角"],
  duration: ["duration", "分镜时长（秒）", "分镜时长", "时间码"],
};
const STORYBOARD_PLACEHOLDER_COMPARE_FIELDS = [
  "scene",
  "description",
  "image_prompt",
  "video_prompt",
  "style_planting",
  "movement",
  "dialogue",
  "shot_size",
  "perspective",
  "duration",
] as const;
const STORYBOARD_PLACEHOLDER_FIELD_TOKENS: Record<string, string[]> = {
  scene: ["scene", "场景", "场景名", "场景名称"],
  description: ["description", "画面描述", "图片描述"],
  image_prompt: [
    "image_prompt",
    "image prompt",
    "image_prompt，video_prompt",
    "image_prompt,video_prompt",
    "图片提示词",
    "图片提示",
    "画风",
  ],
  video_prompt: [
    "video_prompt",
    "video prompt",
    "image_prompt，video_prompt",
    "image_prompt,video_prompt",
    "视频提示词",
    "视频描述",
    "视频提示",
  ],
  style_planting: ["style_planting", "style planting", "画风"],
  movement: ["movement", "运动", "运镜方式"],
  dialogue: ["dialogue", "对白", "台词", "旁白", "台词：台词", "旁白：旁白"],
  shot_size: ["shot_size", "shot size", "景别"],
  perspective: ["perspective", "角度", "视角"],
  duration: ["duration", "时间码", "分镜时长（秒）", "分镜时长"],
};
const SPEAKER_LABEL_RE = /^(?:台词|对白|旁白)\s*[：:]\s*/;
const DIALOGUE_LABEL_RE = /^(?:台词|对白)\s*[：:]\s*/;
const NARRATION_LABEL_RE = /^旁白\s*[：:]\s*/;
const ROLE_LINE_RE = /^角色\s*[：:]\s*/;
const AT_PREFIX_RE = /(^|[\s\n])@(?=\S)/g;

function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

function normalizeEntityName(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function normalizeCompareValue(value: unknown) {
  return normalizeText(value).trim();
}

function normalizeShotNoCompareValue(value: unknown) {
  const normalized = normalizeCompareValue(value);
  if (!normalized) return "";
  if (/^\d+$/.test(normalized)) {
    return String(Number(normalized));
  }
  return normalized.replace(/^0+(?=\d)/, "");
}

function normalizePlaceholderToken(value: unknown) {
  return normalizeCompareValue(value)
    .replace(/<mention\s+[^>]*>[\s\S]*?<\/mention>/gi, "")
    .trim()
    .toLowerCase()
    .replace(/[，,]/g, ",");
}

function isMeaningfulValue(value: unknown) {
  const normalized = normalizeEntityName(value);
  return !!normalized && !STORYBOARD_NONE_VALUE_SET.has(normalized.toLowerCase());
}

function parseStructuredList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEntityName(item)).filter(Boolean);
  }
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map((item) => normalizeEntityName(item)).filter(Boolean)
        : String(value)
            .split(/[、,，/]/)
            .map((item) => normalizeEntityName(item))
            .filter(Boolean);
    } catch {
      return String(value)
        .split(/[、,，/]/)
        .map((item) => normalizeEntityName(item))
        .filter(Boolean);
    }
  }
  return [];
}

function parseStructuredObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFirstHeaderMatch(headerIndexMap: Map<string, number>, candidates: string[]) {
  for (const header of candidates) {
    const index = headerIndexMap.get(header);
    if (typeof index === "number") {
      return { headerName: header, columnIndex: index };
    }
  }
  return null;
}

function parseTimeTokenToSeconds(value: unknown) {
  const token = String(value ?? "").trim();
  if (!token) return Number.NaN;
  if (/^\d+(\.\d+)?$/.test(token)) {
    return Number(token);
  }
  const parts = token.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return Number.NaN;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function normalizeDialoguePlainText(value: unknown) {
  return normalizeText(value)
    .replace(/<mention\s+[^>]*>([\s\S]*?)<\/mention>/gi, "$1")
    .replace(/<(?!br\s*\/?)[^>]+>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(AT_PREFIX_RE, "$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseSpeakerPrefix(value: unknown) {
  const match = String(value ?? "")
    .trim()
    .match(/^([^：:\n]{1,40})\s*[：:]\s*([\s\S]*)$/);
  if (!match?.[1]) return null;
  return {
    speaker: match[1].trim(),
    content: String(match[2] ?? "").trim(),
  };
}

function withSpeakerPrefix(value: unknown, roleNames: string[]) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!roleNames.length) return text;
  if (parseSpeakerPrefix(text)) return text;
  return `${roleNames.join("、")}：${text}`;
}

function uniqueNames(values: unknown[]) {
  return Array.from(new Set(values.map((value) => normalizeEntityName(value)).filter(Boolean)));
}

function parseDialogueSections(value: unknown) {
  const lines = normalizeDialoguePlainText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const roleNames: string[] = [];
  const dialogueLines: string[] = [];
  const narrationLines: string[] = [];

  lines.forEach((line) => {
    if (ROLE_LINE_RE.test(line)) {
      roleNames.push(
        ...String(line.replace(ROLE_LINE_RE, ""))
          .split(/[、,，/]/)
          .map((item) => normalizeEntityName(item))
          .filter(Boolean)
      );
      return;
    }

    if (DIALOGUE_LABEL_RE.test(line)) {
      dialogueLines.push(line.replace(DIALOGUE_LABEL_RE, "").trim());
      return;
    }

    if (NARRATION_LABEL_RE.test(line)) {
      narrationLines.push(line.replace(NARRATION_LABEL_RE, "").trim());
      return;
    }

    dialogueLines.push(line.replace(SPEAKER_LABEL_RE, "").trim());
  });

  return {
    roleNames: uniqueNames(roleNames),
    dialogueLines: dialogueLines.filter(Boolean),
    narrationLines: narrationLines.filter(Boolean),
  };
}

function ensureDialogueRoleText(value: unknown) {
  const text = normalizeDialoguePlainText(value);
  if (!text) return "";

  const parsed = parseDialogueSections(text);
  const normalizedDialogueLines =
    parsed.dialogueLines.length > 0
      ? parsed.dialogueLines
      : parsed.roleNames.length > 0
        ? ["无"]
        : [];

  const lines = [
    ...normalizedDialogueLines
      .map((line) => withSpeakerPrefix(line, parsed.roleNames))
      .filter(Boolean),
    ...parsed.narrationLines,
  ];

  return lines.join("\n");
}

function normalizeFieldValue(field: string, rawValue: unknown, headerName: string) {
  const text = String(rawValue ?? "").trim();
  if (!text) return "";

  if (field === "dialogue") {
    return normalizeDialoguePlainText(text);
  }

  if (field !== "duration") {
    return text;
  }

  if (headerName === "时间码") {
    const [startToken, endToken] = text.split("-").map((part) => part.trim());
    const startSeconds = parseTimeTokenToSeconds(startToken);
    const endSeconds = parseTimeTokenToSeconds(endToken);
    if (
      Number.isFinite(startSeconds) &&
      Number.isFinite(endSeconds) &&
      endSeconds >= startSeconds
    ) {
      return String(endSeconds - startSeconds);
    }
  }

  const numeric = text.match(/-?\d+(\.\d+)?/);
  return numeric ? numeric[0] : text;
}

function buildFieldResolvers(headers: string[]): StoryboardFieldResolvers {
  const headerIndexMap = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = String(header ?? "").trim();
    if (normalized && !headerIndexMap.has(normalized)) {
      headerIndexMap.set(normalized, index);
    }
  });

  return {
    shot_no: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.shot_no),
    scene: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.scene),
    character: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.character),
    costume: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.costume),
    prop: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.prop),
    description: getFirstHeaderMatch(
      headerIndexMap,
      STORYBOARD_FIELD_HEADER_PRIORITY_MAP.description
    ),
    image_prompt: getFirstHeaderMatch(
      headerIndexMap,
      STORYBOARD_FIELD_HEADER_PRIORITY_MAP.image_prompt
    ),
    video_prompt: getFirstHeaderMatch(
      headerIndexMap,
      STORYBOARD_FIELD_HEADER_PRIORITY_MAP.video_prompt
    ),
    style_planting: getFirstHeaderMatch(
      headerIndexMap,
      STORYBOARD_FIELD_HEADER_PRIORITY_MAP.style_planting
    ),
    movement: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.movement),
    dialogue: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.dialogue),
    shot_size: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.shot_size),
    perspective: getFirstHeaderMatch(
      headerIndexMap,
      STORYBOARD_FIELD_HEADER_PRIORITY_MAP.perspective
    ),
    duration: getFirstHeaderMatch(headerIndexMap, STORYBOARD_FIELD_HEADER_PRIORITY_MAP.duration),
    narration: getFirstHeaderMatch(headerIndexMap, STORYBOARD_NARRATION_HEADERS),
  };
}

function serializeMentionAttrs(entry: MentionEntry) {
  const attrs = [`id="${entry.id}"`, `type="${entry.type}"`];
  if (entry.imgUrl) attrs.push(`imgUrl="${entry.imgUrl}"`);
  if (entry.voiceId) attrs.push(`voiceId="${entry.voiceId}"`);
  if (entry.model) attrs.push(`model="${entry.model}"`);
  return attrs.join(" ");
}

function buildMentionMarkup(entry: MentionEntry) {
  return `<mention ${serializeMentionAttrs(entry)}>${normalizeEntityName(entry.name)}</mention>`;
}

function protectExistingMentions(text: string) {
  const placeholders: Array<{ placeholder: string; markup: string }> = [];
  const protectedText = text.replace(EXISTING_MENTION_PATTERN, (match) => {
    const placeholder = `__STORYBOARD_MENTION_${placeholders.length}__`;
    placeholders.push({ placeholder, markup: match });
    return placeholder;
  });
  return { protectedText, placeholders };
}

function restoreProtectedMentions(
  text: string,
  placeholders: Array<{ placeholder: string; markup: string }>
) {
  let restored = text;
  placeholders.forEach(({ placeholder, markup }) => {
    restored = restored.replaceAll(placeholder, markup);
  });
  return restored;
}

function injectMentionsIntoText(text: string, entries: MentionEntry[]) {
  if (!text.trim() || !entries.length) return text;

  const { protectedText, placeholders } = protectExistingMentions(text);
  const generated: Array<{ placeholder: string; markup: string }> = [];
  let result = protectedText;

  entries.forEach((entry) => {
    const name = normalizeEntityName(entry.name);
    if (!name) return;
    const pattern = new RegExp(escapeRegExp(name), "g");
    result = result.replace(pattern, () => {
      const placeholder = `__GENERATED_STORYBOARD_MENTION_${generated.length}__`;
      generated.push({ placeholder, markup: buildMentionMarkup(entry) });
      return placeholder;
    });
  });

  generated.forEach(({ placeholder, markup }) => {
    result = result.replaceAll(placeholder, markup);
  });

  return restoreProtectedMentions(result, placeholders);
}

function buildMentionLookup(entries: MentionEntry[]) {
  return entries.reduce<Record<string, Map<string, MentionEntry>>>((acc, entry) => {
    if (!acc[entry.type]) {
      acc[entry.type] = new Map();
    }
    const normalizedName = normalizeEntityName(entry.name);
    if (normalizedName && !acc[entry.type].has(normalizedName)) {
      acc[entry.type].set(normalizedName, entry);
    }
    return acc;
  }, {});
}

function getMentionEntryByTypeAndName(
  lookup: Record<string, Map<string, MentionEntry>>,
  type: MentionEntry["type"],
  name: string
) {
  const normalizedName = normalizeEntityName(name);
  if (!normalizedName) return null;
  return lookup[type]?.get(normalizedName) ?? null;
}

function buildSelectedMentionEntries({
  sceneName,
  characterNames,
  propNames,
  mentionLookup,
}: {
  sceneName: string;
  characterNames: string[];
  propNames: string[];
  mentionLookup: Record<string, Map<string, MentionEntry>>;
}) {
  const entries: MentionEntry[] = [];
  const pushEntry = (entry: MentionEntry | null) => {
    if (!entry) return;
    if (entries.some((item) => item.id === entry.id && item.type === entry.type)) return;
    entries.push(entry);
  };

  pushEntry(getMentionEntryByTypeAndName(mentionLookup, "scene", sceneName));
  characterNames.forEach((name) =>
    pushEntry(getMentionEntryByTypeAndName(mentionLookup, "character", name))
  );
  propNames.forEach((name) => pushEntry(getMentionEntryByTypeAndName(mentionLookup, "prop", name)));

  return entries;
}

function buildEntitySummary(entries: MentionEntry[], separator: string) {
  if (!entries.length) return "";

  const sceneMarkup = entries
    .filter((entry) => entry.type === "scene")
    .map((entry) => buildMentionMarkup(entry))
    .join("、");
  const characterMarkup = entries
    .filter((entry) => entry.type === "character")
    .map((entry) => buildMentionMarkup(entry))
    .join("、");
  const propMarkup = entries
    .filter((entry) => entry.type === "prop")
    .map((entry) => buildMentionMarkup(entry))
    .join("、");

  return [
    sceneMarkup ? `场景：${sceneMarkup}` : "",
    characterMarkup ? `角色：${characterMarkup}` : "",
    propMarkup ? `道具：${propMarkup}` : "",
  ]
    .filter(Boolean)
    .join(separator);
}

function hasEntryReference(text: string, entry: MentionEntry) {
  const name = normalizeEntityName(entry.name);
  if (!name) return false;
  return text.includes(buildMentionMarkup(entry)) || text.includes(name);
}

function trimSummaryJoinSuffix(text: string) {
  return String(text)
    .replace(/[，,；;。.!！？?、\s]+$/u, "")
    .trim();
}

function applyRichTextMentions(
  text: string,
  field: "description" | "image_prompt" | "video_prompt",
  context: {
    sceneName: string;
    characterNames: string[];
    propNames: string[];
    mentionLookup: Record<string, Map<string, MentionEntry>>;
  }
) {
  const sourceText = String(text ?? "").trim();
  const selectedEntries = buildSelectedMentionEntries(context);
  const injectedText = injectMentionsIntoText(sourceText, selectedEntries);
  const entitySummary = buildEntitySummary(selectedEntries, field === "description" ? "，" : "；");
  if (!entitySummary) {
    return injectedText;
  }
  if (/(场景：|角色：|道具：)/.test(injectedText)) {
    return injectedText;
  }
  if (!injectedText) {
    return entitySummary;
  }
  if (
    (field === "image_prompt" || field === "video_prompt") &&
    selectedEntries.some((entry) => hasEntryReference(injectedText, entry))
  ) {
    return injectedText;
  }
  const trimmed = trimSummaryJoinSuffix(injectedText);
  return `${trimmed}${field === "description" ? "\n" : "。"}${entitySummary}`;
}

function getRowFieldValue(row: string[], resolver: StoryboardFieldResolver | null, field: string) {
  if (!resolver) return "";
  return normalizeFieldValue(field, row[resolver.columnIndex], resolver.headerName);
}

function extractEntityNames(
  row: string[],
  resolver: StoryboardFieldResolver | null,
  field: string
) {
  return parseStructuredList(getRowFieldValue(row, resolver, field)).filter(isMeaningfulValue);
}

function normalizeTable(table: StoryboardTableData) {
  const headers = table.headers.map((header) => String(header ?? "").trim());
  return {
    headers,
    rows: table.rows.map((row) => headers.map((_, index) => String(row[index] ?? ""))),
  };
}

function isPlaceholderFieldValue(field: string, value: string) {
  const normalized = normalizePlaceholderToken(value);
  if (!normalized) return false;
  if (field === "dialogue") {
    return normalized.includes("台词：台词") || normalized.includes("旁白：旁白");
  }
  return (STORYBOARD_PLACEHOLDER_FIELD_TOKENS[field] ?? []).some(
    (candidate) => normalizePlaceholderToken(candidate) === normalized
  );
}

function isPlaceholderRow(headers: string[], row: string[]) {
  const fieldResolvers = buildFieldResolvers(headers);
  const shotNo = getRowFieldValue(row, fieldResolvers.shot_no, "shot_no");
  if (!/^0*1$/.test(shotNo)) {
    return false;
  }

  let placeholderCount = 0;
  let nonPlaceholderCount = 0;

  STORYBOARD_PLACEHOLDER_COMPARE_FIELDS.forEach((field) => {
    const value = getRowFieldValue(row, fieldResolvers[field], field);
    if (!value) return;
    if (isPlaceholderFieldValue(field, value)) {
      placeholderCount += 1;
      return;
    }
    nonPlaceholderCount += 1;
  });

  return placeholderCount >= 4 && nonPlaceholderCount === 0;
}

function stripPlaceholderRows(table: StoryboardTableData) {
  return {
    headers: [...table.headers],
    rows: table.rows.filter((row) => !isPlaceholderRow(table.headers, row)),
  };
}

async function listAllWorldItems<T>(loader: (page: number) => Promise<Paginated<T>>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= WORLD_MAX_PAGES; page += 1) {
    const response = await loader(page);
    const list = Array.isArray(response?.list) ? response.list : [];
    items.push(...list);
    if (list.length < WORLD_PAGE_SIZE) {
      break;
    }
  }
  return items;
}

function buildWorldEntityNameMap(items: Asset[], type: "character" | "prop") {
  return items.reduce((acc, item) => {
    const addName = (name: unknown) => {
      const normalized = normalizeEntityName(name);
      if (!normalized || acc.has(normalized)) return;
      acc.set(normalized, String(item.id ?? item.value ?? ""));
    };

    addName(item.name);
    if (type === "character") {
      parseStructuredList(item.aliases).forEach(addName);
    }

    return acc;
  }, new Map<string, string>());
}

async function loadWorldRoleMap(worldId: string) {
  const items = await listAllWorldItems((page) =>
    backendApi.post<Paginated<Asset>>("/api/user/world/list/worldrole", {
      data: { worldId, page, pageSize: WORLD_PAGE_SIZE },
    })
  );
  return buildWorldEntityNameMap(items, "character");
}

async function loadWorldPropMap(worldId: string) {
  const items = await listAllWorldItems((page) =>
    backendApi.post<Paginated<Asset>>("/api/user/world/list/worldprop", {
      data: { worldId, page, pageSize: WORLD_PAGE_SIZE },
    })
  );
  return buildWorldEntityNameMap(items, "prop");
}

async function loadWorldSceneMap(worldId: string) {
  const items = await listAllWorldItems((page) =>
    backendApi.post<Paginated<Asset>>("/api/user/world/list/worldscene", {
      data: { worldId, page, pageSize: WORLD_PAGE_SIZE },
    })
  );
  return items.reduce((acc, item) => {
    const name = normalizeEntityName(item.name);
    if (name && !acc.has(name)) {
      acc.set(name, item);
    }
    return acc;
  }, new Map<string, Asset>());
}

async function buildMentionEntries(worldId: string) {
  if (!worldId) return [];

  const [roles, scenes, props] = await Promise.all([
    listAllWorldItems((page) =>
      backendApi.post<Paginated<Asset>>("/api/user/world/list/worldrole", {
        data: { worldId, page, pageSize: WORLD_PAGE_SIZE },
      })
    ),
    listAllWorldItems((page) =>
      backendApi.post<Paginated<Asset>>("/api/user/world/list/worldscene", {
        data: { worldId, page, pageSize: WORLD_PAGE_SIZE },
      })
    ),
    listAllWorldItems((page) =>
      backendApi.post<Paginated<Asset>>("/api/user/world/list/worldprop", {
        data: { worldId, page, pageSize: WORLD_PAGE_SIZE },
      })
    ),
  ]);

  const roleEntries = roles.flatMap((role) => {
    const imgUrl = ossUrl(Array.isArray(role.roleImgPath) ? role.roleImgPath[0] : "");
    const baseEntry = {
      id: String(role.id ?? ""),
      type: "character" as const,
      imgUrl,
      voiceId: typeof role.voiceId === "string" ? role.voiceId.trim() : undefined,
      model: typeof role.model === "string" ? role.model.trim() : undefined,
    };

    const aliasEntries = parseStructuredList(role.aliases).map((alias) => ({
      ...baseEntry,
      name: alias,
    }));
    const variantEntries = Object.keys(parseStructuredObject(role.otherImgPath)).map(
      (variantName) => ({
        ...baseEntry,
        name: normalizeEntityName(variantName),
      })
    );

    return [
      { ...baseEntry, name: normalizeEntityName(role.name) },
      ...aliasEntries,
      ...variantEntries,
    ].filter((entry) => entry.id && entry.name);
  });

  const sceneEntries = scenes
    .map((scene) => ({
      id: String(scene.id ?? ""),
      type: "scene" as const,
      name: normalizeEntityName(scene.name),
      imgUrl: ossUrl(Array.isArray(scene.sceneImgPath) ? scene.sceneImgPath[0] : ""),
    }))
    .filter((entry) => entry.id && entry.name);

  const propEntries = props
    .map((prop) => ({
      id: String(prop.id ?? ""),
      type: "prop" as const,
      name: normalizeEntityName(prop.name),
      imgUrl: ossUrl(Array.isArray(prop.propImgPath) ? prop.propImgPath[0] : ""),
    }))
    .filter((entry) => entry.id && entry.name);

  return [...roleEntries, ...sceneEntries, ...propEntries];
}

async function buildStoryboardSaveDatas(
  table: StoryboardTableData,
  options: { worldId?: string | null; stylePaintingName?: string | null }
) {
  if (!table.headers.length || !table.rows.length) {
    return null;
  }

  const worldId = normalizeEntityName(options.worldId);
  const normalizedTable = stripPlaceholderRows(normalizeTable(table));
  const fieldResolvers = buildFieldResolvers(normalizedTable.headers);
  const mentionEntries = worldId ? await buildMentionEntries(worldId) : [];
  const mentionLookup = buildMentionLookup(mentionEntries);
  const fallbackStyle = normalizeEntityName(options.stylePaintingName);
  let previousSceneName = "";

  const dataRows = normalizedTable.rows.map((row) => {
    const rawSceneName = getRowFieldValue(row, fieldResolvers.scene, "scene");
    const sceneName = rawSceneName || previousSceneName;
    if (sceneName) {
      previousSceneName = sceneName;
    }

    const mentionContext = {
      sceneName,
      characterNames: extractEntityNames(row, fieldResolvers.character, "character"),
      propNames: extractEntityNames(row, fieldResolvers.prop, "prop"),
      mentionLookup,
    };

    return STORYBOARD_SAVE_FIELD_ORDER.map((field) => {
      if (field === "dialogue") {
        const dialogueText = getRowFieldValue(row, fieldResolvers.dialogue, "dialogue");
        const narrationText = getRowFieldValue(row, fieldResolvers.narration, "dialogue");
        const combined = [dialogueText || "", narrationText || ""].filter(Boolean).join("\n");
        return ensureDialogueRoleText(combined || dialogueText || narrationText);
      }

      let normalizedValue = getRowFieldValue(row, fieldResolvers[field], field);
      if (field === "scene" && !normalizedValue) {
        normalizedValue = previousSceneName;
      }
      if (field === "style_planting" && !normalizedValue && fallbackStyle) {
        normalizedValue = fallbackStyle;
      }
      if (field === "duration" || field === "scene") {
        return normalizedValue;
      }
      if (field === "description" || field === "image_prompt" || field === "video_prompt") {
        return applyRichTextMentions(normalizedValue, field, mentionContext);
      }
      return injectMentionsIntoText(normalizedValue, buildSelectedMentionEntries(mentionContext));
    });
  });

  return [[...STORYBOARD_SAVE_FIELD_ORDER], ...dataRows];
}

function buildFieldIndexMap(headers: string[]) {
  return headers.reduce<Record<string, number>>((acc, header, index) => {
    acc[String(header ?? "").trim()] = index;
    return acc;
  }, {});
}

function getImportedFieldValue(row: string[], indexMap: Record<string, number>, field: string) {
  const columnIndex = indexMap[field];
  if (columnIndex === undefined) return "";
  return normalizeCompareValue(row[columnIndex] ?? "");
}

function buildStoryboardRowSignature(fieldGetter: (field: string) => string) {
  const payload = STORYBOARD_BACKFILL_SIGNATURE_FIELDS.reduce<Record<string, string>>(
    (acc, field) => {
      acc[field] =
        field === "shot_no"
          ? normalizeShotNoCompareValue(fieldGetter(field))
          : normalizeCompareValue(fieldGetter(field));
      return acc;
    },
    {}
  );
  return Object.values(payload).some(Boolean) ? JSON.stringify(payload) : "";
}

function buildImportedRows(datas: string[][]) {
  const [headers = [], ...rows] = datas;
  const indexMap = buildFieldIndexMap(headers);

  return rows.map<StoryboardImportedRow>((cells, rowIndex) => {
    const getField = (field: string) => getImportedFieldValue(cells, indexMap, field);
    return {
      rowIndex,
      shotNo: getField("shot_no"),
      normalizedShotNo: normalizeShotNoCompareValue(getField("shot_no")),
      scene: getField("scene"),
      description: getField("description"),
      imagePrompt: getField("image_prompt"),
      videoPrompt: getField("video_prompt"),
      stylePlanting: getField("style_planting"),
      signature: buildStoryboardRowSignature(getField),
    };
  });
}

function buildShotValueMapByPresetKey(shotValues: ShotValue[]) {
  return shotValues.reduce<Record<string, ShotValue>>((acc, cell) => {
    if (cell.presetColumnKey && !acc[cell.presetColumnKey]) {
      acc[cell.presetColumnKey] = cell;
    }
    return acc;
  }, {});
}

function getShotCellTextValue(cell?: ShotValue) {
  if (!cell) return "";
  if (Array.isArray(cell.scenes) && cell.scenes.length > 0) {
    const first = cell.scenes[0] as { name?: string };
    return normalizeCompareValue(first?.name ?? "");
  }
  return normalizeCompareValue(cell.richText?.content ?? cell.value ?? "");
}

function getShotCellEntityIds(cell?: ShotValue) {
  if (!cell) return [];
  if (Array.isArray(cell.characters) && cell.characters.length > 0) {
    return cell.characters
      .map((item) =>
        normalizeEntityName(
          typeof item === "object" && item
            ? ((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).value)
            : item
        )
      )
      .filter(Boolean);
  }
  if (Array.isArray(cell.values) && cell.values.length > 0) {
    return cell.values
      .map((item) =>
        normalizeEntityName(
          typeof item === "object" && item
            ? ((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).value)
            : item
        )
      )
      .filter(Boolean);
  }
  return [];
}

function buildPersistedRows(shots: ShotRow[]) {
  return shots.map<StoryboardPersistedRow>((shot) => {
    const valueMap = buildShotValueMapByPresetKey(shot.shotValues ?? []);
    const getField = (field: string) => getShotCellTextValue(valueMap[field]);
    return {
      shotId: String(shot.shotId ?? ""),
      shotNo: getField("shot_no"),
      normalizedShotNo: normalizeShotNoCompareValue(getField("shot_no")),
      scene: getField("scene"),
      characterIds: getShotCellEntityIds(valueMap.character),
      propIds: getShotCellEntityIds(valueMap.prop),
      description: getField("description"),
      imagePrompt: getField("image_prompt"),
      videoPrompt: getField("video_prompt"),
      stylePlanting: getField("style_planting"),
      signature: buildStoryboardRowSignature(getField),
    };
  });
}

function matchRows(importedRows: StoryboardImportedRow[], persistedRows: StoryboardPersistedRow[]) {
  const matchedShotIndexes = new Set<number>();
  const matchedIndexes = new Map<number, number>();
  const unresolvedImportIndexes: number[] = [];

  importedRows.forEach((row, importIndex) => {
    if (!row.signature) {
      unresolvedImportIndexes.push(importIndex);
      return;
    }
    const shotIndex = persistedRows.findIndex(
      (candidate, candidateIndex) =>
        !matchedShotIndexes.has(candidateIndex) &&
        candidate.signature &&
        candidate.signature === row.signature
    );
    if (shotIndex !== -1) {
      matchedIndexes.set(importIndex, shotIndex);
      matchedShotIndexes.add(shotIndex);
      return;
    }
    unresolvedImportIndexes.push(importIndex);
  });

  unresolvedImportIndexes.forEach((importIndex) => {
    const row = importedRows[importIndex];
    if (!row?.normalizedShotNo || matchedIndexes.has(importIndex)) return;
    const shotIndex = persistedRows.findIndex(
      (candidate, candidateIndex) =>
        !matchedShotIndexes.has(candidateIndex) &&
        candidate.normalizedShotNo &&
        candidate.normalizedShotNo === row.normalizedShotNo
    );
    if (shotIndex !== -1) {
      matchedIndexes.set(importIndex, shotIndex);
      matchedShotIndexes.add(shotIndex);
    }
  });

  if (importedRows.length === persistedRows.length) {
    unresolvedImportIndexes.forEach((importIndex) => {
      if (matchedIndexes.has(importIndex) || matchedShotIndexes.has(importIndex)) return;
      matchedIndexes.set(importIndex, importIndex);
      matchedShotIndexes.add(importIndex);
    });
  }

  return matchedIndexes;
}

async function fetchStoryboardShotsForBackfill(episodeId: string) {
  const shots: ShotRow[] = [];
  for (let page = 1; page <= STORYBOARD_QUERY_MAX_PAGES; page += 1) {
    const response = await backendApi.post<Paginated<ShotRow>>("/api/user/shot/queryPage", {
      data: {
        storyBoardId: episodeId,
        page,
        pageSize: STORYBOARD_QUERY_PAGE_SIZE,
        shotIds: [],
        presetColumnKeys: [],
      },
    });
    const list = Array.isArray(response?.list) ? response.list : [];
    shots.push(...list);
    if (
      !list.length ||
      list.length < STORYBOARD_QUERY_PAGE_SIZE ||
      (response?.totalCount && shots.length >= response.totalCount)
    ) {
      break;
    }
  }
  return shots;
}

function isPersistedShotEmpty(shot: ShotRow) {
  const valueMap = buildShotValueMapByPresetKey(shot.shotValues ?? []);
  return !STORYBOARD_EMPTY_ROW_FIELD_KEYS.some((field) => !!getShotCellTextValue(valueMap[field]));
}

async function cleanupExtraEmptyShots(episodeId: string, shots: ShotRow[], expectedCount: number) {
  if (!episodeId || !expectedCount || shots.length <= expectedCount) {
    return shots;
  }

  const extraCount = shots.length - expectedCount;
  const blankShots = shots.filter(isPersistedShotEmpty).slice(0, extraCount);
  if (!blankShots.length) {
    return shots;
  }

  for (const shot of blankShots) {
    if (!shot.shotId) continue;
    await backendApi.post(`/api/user/shot/delete/${shot.shotId}`);
  }

  return fetchStoryboardShotsForBackfill(episodeId);
}

async function deleteExistingShots(episodeId: string) {
  const shots = await fetchStoryboardShotsForBackfill(episodeId);
  for (const shot of shots) {
    if (!shot.shotId) continue;
    await backendApi.post(`/api/user/shot/delete/${shot.shotId}`);
  }
}

function buildFieldBackfillState(totalRows: number): StoryboardBackfillState {
  return {
    attemptedCount: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: totalRows,
    failedRows: [],
    errorMessage: "",
  };
}

function buildBackfillSummary(totalRows: number): StoryboardBackfillSummary {
  return {
    ...buildFieldBackfillState(totalRows),
    scene: buildFieldBackfillState(totalRows),
    character: buildFieldBackfillState(totalRows),
    prop: buildFieldBackfillState(totalRows),
    imagePrompt: buildFieldBackfillState(totalRows),
    stylePlanting: buildFieldBackfillState(totalRows),
    autoload: {
      attemptedCount: 0,
      successCount: 0,
      failedCount: 0,
      failedColumns: [],
      errorMessage: "",
    },
  };
}

function setFieldBackfillFailureState(
  summary: StoryboardBackfillState,
  importedRows: StoryboardImportedRow[],
  selector: (row: StoryboardImportedRow, index: number) => boolean,
  fallbackMessage: string
) {
  const targetedRows = importedRows.filter((row, index) => selector(row, index));
  summary.failedCount = targetedRows.length;
  summary.failedRows = targetedRows.map((row) => row.rowIndex);
  summary.skippedCount = importedRows.length - targetedRows.length;
  summary.errorMessage = fallbackMessage;
}

function isFieldValueEqual(left: unknown, right: unknown) {
  return normalizeCompareValue(left) === normalizeCompareValue(right);
}

function isEntityIdListEqual(left: string[], right: string[]) {
  const normalizedLeft = Array.from(
    new Set(left.map((item) => normalizeEntityName(item)).filter(Boolean))
  ).sort();
  const normalizedRight = Array.from(
    new Set(right.map((item) => normalizeEntityName(item)).filter(Boolean))
  ).sort();
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function hasPlainText(value: unknown) {
  return !!String(value ?? "")
    .replace(/<mention\s+[^>]*>([\s\S]*?)<\/mention>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function validateImportedRows(rows: StoryboardImportedRow[]) {
  const invalidRows: Array<{ rowIndex: number; missingFields: string[] }> = [];
  rows.forEach((row) => {
    const missingFields: string[] = [];
    if (!isMeaningfulValue(row.scene)) missingFields.push("场景");
    if (!hasPlainText(row.description)) missingFields.push("画面描述");
    if (!hasPlainText(row.imagePrompt)) missingFields.push("图片提示词");
    if (!hasPlainText(row.videoPrompt)) missingFields.push("视频提示词");
    if (missingFields.length) {
      invalidRows.push({ rowIndex: row.rowIndex, missingFields });
    }
  });
  return invalidRows;
}

function findStoryboardColumn(
  columns: ShotColumn[],
  options: { presetKeys?: string[]; columnTypes?: string[]; columnNames?: string[] }
) {
  const presetKeys = new Set(
    (options.presetKeys ?? []).map((key) => normalizeEntityName(key).toLowerCase()).filter(Boolean)
  );
  const columnTypes = new Set(
    (options.columnTypes ?? [])
      .map((type) => normalizeEntityName(type).toUpperCase())
      .filter(Boolean)
  );
  const columnNames = new Set(
    (options.columnNames ?? [])
      .map((name) => normalizeEntityName(name).toLowerCase())
      .filter(Boolean)
  );

  if (presetKeys.size > 0) {
    const matched = columns.find((column) =>
      presetKeys.has(normalizeEntityName(column.presetColumnKey).toLowerCase())
    );
    if (matched) return matched;
  }

  if (columnTypes.size > 0) {
    const matched = columns.find((column) =>
      columnTypes.has(normalizeEntityName(column.columnType).toUpperCase())
    );
    if (matched) return matched;
  }

  if (columnNames.size > 0) {
    const matched = columns.find((column) =>
      columnNames.has(normalizeEntityName(column.columnName).toLowerCase())
    );
    if (matched) return matched;
  }

  return null;
}

function shouldAutoloadStoryboardColumn(column: ShotColumn) {
  const presetKey = normalizeEntityName(column.presetColumnKey).toLowerCase();
  const columnType = normalizeEntityName(column.columnType).toUpperCase();
  const columnName = normalizeEntityName(column.columnName);

  if (presetKey === "character" || presetKey === "scene") return true;
  if (columnType === "CHARACTER" || columnType === "SCENE") return true;
  return STORYBOARD_AUTOLOAD_COLUMN_NAME_SET.has(columnName);
}

function resolveWorldEntityIdsByNames(names: string[], lookup: Map<string, string>) {
  return Array.from(
    new Set(names.map((name) => lookup.get(normalizeEntityName(name)) ?? "").filter(Boolean))
  );
}

async function buildEntityBackfillRows(table: StoryboardTableData, worldId: string) {
  if (!worldId || !table.headers.length || !table.rows.length) {
    return [];
  }

  const fieldResolvers = buildFieldResolvers(table.headers);
  const [roleMap, propMap] = await Promise.all([
    loadWorldRoleMap(worldId),
    loadWorldPropMap(worldId),
  ]);

  return table.rows.map<StoryboardEntityBackfillRow>((row, rowIndex) => {
    const characterNames = extractEntityNames(row, fieldResolvers.character, "character");
    const propNames = extractEntityNames(row, fieldResolvers.prop, "prop");
    return {
      rowIndex,
      characterIds: resolveWorldEntityIdsByNames(characterNames, roleMap),
      propIds: resolveWorldEntityIdsByNames(propNames, propMap),
    };
  });
}

async function ensureSceneIdByName(
  sceneName: string,
  worldId: string,
  sceneMap: Map<string, Asset>
) {
  const normalizedName = normalizeEntityName(sceneName);
  if (!normalizedName || !worldId) return "";

  const existing = sceneMap.get(normalizedName);
  if (existing?.id) {
    return String(existing.id);
  }

  // Java's `/create/worldscene` returns the new scene id as a bare
  // string in `data` (body = `{ success: true, data: "1413" }`), so
  // `backendApi` hands us back the raw string. Older Studio builds
  // returned `{ id, ... }`; handle both shapes for compatibility.
  const created = await backendApi.post<Asset | string>("/api/user/world/create/worldscene", {
    data: {
      worldId,
      name: normalizedName,
      description: "",
      prompt: "",
      sceneImgPath: [],
      referenceImgPath: [],
    },
  });

  const id =
    typeof created === "string" || typeof created === "number"
      ? String(created)
      : String(created?.id ?? created?.value ?? "");
  if (id) {
    const base = typeof created === "object" && created !== null ? created : ({} as Asset);
    sceneMap.set(normalizedName, { ...base, id, name: normalizedName });
  }
  return id;
}

async function runStoryboardColumnAutoload(
  columns: ShotColumn[],
  backfill: StoryboardBackfillSummary
) {
  const targetColumns = columns.filter(shouldAutoloadStoryboardColumn);
  backfill.autoload.attemptedCount = targetColumns.length;

  for (const column of targetColumns) {
    try {
      await backendApi.post("/api/ai/chat/autoload/column", {
        data: { columnId: String(column.id ?? ""), recoverOldData: true },
        timeout: 300_000,
      });
      backfill.autoload.successCount += 1;
    } catch (error) {
      backfill.autoload.failedCount += 1;
      backfill.autoload.failedColumns.push(
        String(column.columnName ?? column.presetColumnKey ?? column.id ?? "")
      );
      backfill.autoload.errorMessage = error instanceof Error ? error.message : "自动关联失败";
    }
  }
}

export function getStoryboardBackfillWarning(backfill: StoryboardBackfillSummary) {
  const parts: string[] = [];
  if (Number(backfill.failedCount || 0) > 0) {
    parts.push(`画面描述 ${backfill.failedCount} 条未写回`);
  }
  if (Number(backfill.scene?.failedCount || 0) > 0) {
    parts.push(`场景 ${backfill.scene.failedCount} 条未写回`);
  }
  if (Number(backfill.character?.failedCount || 0) > 0) {
    parts.push(`角色 ${backfill.character.failedCount} 条未写回`);
  }
  if (Number(backfill.prop?.failedCount || 0) > 0) {
    parts.push(`道具 ${backfill.prop.failedCount} 条未写回`);
  }
  if (Number(backfill.imagePrompt?.failedCount || 0) > 0) {
    parts.push(`图片提示词 ${backfill.imagePrompt.failedCount} 条未写回`);
  }
  if (Number(backfill.stylePlanting?.failedCount || 0) > 0) {
    parts.push(`画风 ${backfill.stylePlanting.failedCount} 条未写回`);
  }
  if (Number(backfill.autoload?.failedCount || 0) > 0) {
    parts.push(`自动关联 ${backfill.autoload.failedCount} 列失败`);
  }
  return parts.length ? `分镜已保存，但有 ${parts.join("，")}，请重试。` : "";
}

export async function saveStoryboardTableWithBackfill(params: {
  episodeId: string;
  table: StoryboardTableData;
  worldId?: string | null;
  stylePaintingName?: string | null;
  autoload?: boolean;
  replaceExisting?: boolean;
}) {
  const normalizedTable = stripPlaceholderRows(normalizeTable(params.table));
  const datas = await buildStoryboardSaveDatas(normalizedTable, {
    worldId: params.worldId,
    stylePaintingName: params.stylePaintingName,
  });

  if (!datas) {
    throw new Error("分镜保存数据构建失败");
  }

  if (params.replaceExisting) {
    await deleteExistingShots(params.episodeId);
  }

  await backendApi.post("/api/ai/chat/save/storyboard", {
    data: { episodeId: params.episodeId, datas, autoload: params.autoload },
    timeout: 300_000,
  });

  const backfill = buildBackfillSummary(importedRows.length);
  if (!importedRows.length) {
    return { backfill, warning: "" };
  }

  const worldId = normalizeEntityName(params.worldId);
  const entityBackfillRows = worldId ? await buildEntityBackfillRows(normalizedTable, worldId) : [];

  try {
    const columns = await backendApi.post<ShotColumn[]>("/api/user/shotColumn/list", {
      data: { storyBoardId: params.episodeId },
    });
    const shotNoColumn = findStoryboardColumn(columns, {
      presetKeys: ["shot_no"],
      columnNames: STORYBOARD_FIELD_HEADER_PRIORITY_MAP.shot_no,
    });
    const descriptionColumn = findStoryboardColumn(columns, {
      presetKeys: ["description"],
      columnNames: STORYBOARD_FIELD_HEADER_PRIORITY_MAP.description,
    });
    const sceneColumn = findStoryboardColumn(columns, {
      presetKeys: ["scene"],
      columnTypes: ["SCENE"],
      columnNames: STORYBOARD_FIELD_HEADER_PRIORITY_MAP.scene,
    });
    const characterColumn = findStoryboardColumn(columns, {
      presetKeys: ["character"],
      columnTypes: ["CHARACTER"],
      columnNames: STORYBOARD_FIELD_HEADER_PRIORITY_MAP.character,
    });
    const propColumn = findStoryboardColumn(columns, {
      presetKeys: ["prop", "props"],
      columnNames: STORYBOARD_FIELD_HEADER_PRIORITY_MAP.prop,
    });
    const imagePromptColumn = findStoryboardColumn(columns, {
      presetKeys: ["image_prompt"],
      columnNames: STORYBOARD_FIELD_HEADER_PRIORITY_MAP.image_prompt,
    });
    const videoPromptColumn = findStoryboardColumn(columns, {
      presetKeys: ["video_prompt"],
      columnNames: STORYBOARD_FIELD_HEADER_PRIORITY_MAP.video_prompt,
    });
    const stylePlantingColumn = findStoryboardColumn(columns, {
      presetKeys: ["style_planting"],
      columnNames: STORYBOARD_FIELD_HEADER_PRIORITY_MAP.style_planting,
    });

    let persistedShots = await fetchStoryboardShotsForBackfill(params.episodeId);
    if (params.replaceExisting) {
      persistedShots = await cleanupExtraEmptyShots(
        params.episodeId,
        persistedShots,
        importedRows.length
      );
    }
    const persistedRows = buildPersistedRows(persistedShots);
    const matchedIndexes =
      params.replaceExisting && persistedRows.length === importedRows.length
        ? new Map(importedRows.map((_item, index) => [index, index]))
        : matchRows(importedRows, persistedRows);
    const sceneMap = worldId ? await loadWorldSceneMap(worldId) : new Map<string, Asset>();

    backfill.skippedCount = 0;
    backfill.scene.skippedCount = 0;
    backfill.character.skippedCount = 0;
    backfill.prop.skippedCount = 0;
    backfill.imagePrompt.skippedCount = 0;
    backfill.stylePlanting.skippedCount = 0;

    for (let importIndex = 0; importIndex < importedRows.length; importIndex += 1) {
      const importedRow = importedRows[importIndex];
      const entityBackfillRow = entityBackfillRows[importIndex] ?? {
        rowIndex: importIndex,
        characterIds: [],
        propIds: [],
      };
      const matchedShotIndex = matchedIndexes.get(importIndex);
      const persistedRow = matchedShotIndex === undefined ? null : persistedRows[matchedShotIndex];

      if (!persistedRow?.shotId) {
        if (importedRow.description) {
          backfill.failedCount += 1;
          backfill.failedRows.push(importedRow.rowIndex);
        } else {
          backfill.skippedCount += 1;
        }
        if (importedRow.scene) {
          backfill.scene.failedCount += 1;
          backfill.scene.failedRows.push(importedRow.rowIndex);
        } else {
          backfill.scene.skippedCount += 1;
        }
        if (entityBackfillRow.characterIds.length > 0) {
          backfill.character.failedCount += 1;
          backfill.character.failedRows.push(importedRow.rowIndex);
        } else {
          backfill.character.skippedCount += 1;
        }
        if (entityBackfillRow.propIds.length > 0) {
          backfill.prop.failedCount += 1;
          backfill.prop.failedRows.push(importedRow.rowIndex);
        } else {
          backfill.prop.skippedCount += 1;
        }
        if (importedRow.imagePrompt) {
          backfill.imagePrompt.failedCount += 1;
          backfill.imagePrompt.failedRows.push(importedRow.rowIndex);
        } else {
          backfill.imagePrompt.skippedCount += 1;
        }
        if (importedRow.stylePlanting) {
          backfill.stylePlanting.failedCount += 1;
          backfill.stylePlanting.failedRows.push(importedRow.rowIndex);
        } else {
          backfill.stylePlanting.skippedCount += 1;
        }
        continue;
      }

      if (
        importedRow.shotNo &&
        shotNoColumn?.id &&
        !isFieldValueEqual(importedRow.shotNo, persistedRow.shotNo)
      ) {
        await backendApi.post("/api/user/shotValue/input", {
          data: {
            shotId: persistedRow.shotId,
            shotColumnId: String(shotNoColumn.id),
            value: importedRow.shotNo,
          },
        });
      }

      if (!importedRow.description || !descriptionColumn?.id) {
        backfill.skippedCount += 1;
      } else if (isFieldValueEqual(importedRow.description, persistedRow.description)) {
        backfill.skippedCount += 1;
      } else {
        backfill.attemptedCount += 1;
        try {
          await backendApi.post("/api/user/shotValue/input", {
            data: {
              shotId: persistedRow.shotId,
              shotColumnId: String(descriptionColumn.id),
              value: importedRow.description,
            },
          });
          backfill.successCount += 1;
        } catch {
          backfill.failedCount += 1;
          backfill.failedRows.push(importedRow.rowIndex);
        }
      }

      if (!importedRow.scene || !sceneColumn?.id || !worldId) {
        backfill.scene.skippedCount += 1;
      } else {
        backfill.scene.attemptedCount += 1;
        try {
          const sceneId = await ensureSceneIdByName(importedRow.scene, worldId, sceneMap);
          await backendApi.post("/api/user/shotValue/input", {
            data: {
              shotId: persistedRow.shotId,
              shotColumnId: String(sceneColumn.id),
              value: sceneId || "",
              presetColumnKey: "scene",
              sceneId: sceneId || "",
              sceneName: importedRow.scene || "",
              worldId: worldId || "",
            },
          });
          backfill.scene.successCount += 1;
        } catch {
          backfill.scene.failedCount += 1;
          backfill.scene.failedRows.push(importedRow.rowIndex);
        }
      }

      if (!entityBackfillRow.characterIds.length || !characterColumn?.id) {
        backfill.character.skippedCount += 1;
      } else if (isEntityIdListEqual(entityBackfillRow.characterIds, persistedRow.characterIds)) {
        backfill.character.skippedCount += 1;
      } else {
        backfill.character.attemptedCount += 1;
        try {
          await backendApi.post("/api/user/shotValue/input", {
            data: {
              shotId: persistedRow.shotId,
              shotColumnId: String(characterColumn.id),
              value: "",
              values: entityBackfillRow.characterIds,
            },
          });
          backfill.character.successCount += 1;
        } catch {
          backfill.character.failedCount += 1;
          backfill.character.failedRows.push(importedRow.rowIndex);
        }
      }

      if (!entityBackfillRow.propIds.length || !propColumn?.id) {
        backfill.prop.skippedCount += 1;
      } else if (isEntityIdListEqual(entityBackfillRow.propIds, persistedRow.propIds)) {
        backfill.prop.skippedCount += 1;
      } else {
        backfill.prop.attemptedCount += 1;
        try {
          await backendApi.post("/api/user/shotValue/input", {
            data: {
              shotId: persistedRow.shotId,
              shotColumnId: String(propColumn.id),
              value: "",
              values: entityBackfillRow.propIds,
            },
          });
          backfill.prop.successCount += 1;
        } catch {
          backfill.prop.failedCount += 1;
          backfill.prop.failedRows.push(importedRow.rowIndex);
        }
      }

      if (!importedRow.imagePrompt || !imagePromptColumn?.id) {
        backfill.imagePrompt.skippedCount += 1;
      } else if (isFieldValueEqual(importedRow.imagePrompt, persistedRow.imagePrompt)) {
        backfill.imagePrompt.skippedCount += 1;
      } else {
        backfill.imagePrompt.attemptedCount += 1;
        try {
          await backendApi.post("/api/user/shotValue/input", {
            data: {
              shotId: persistedRow.shotId,
              shotColumnId: String(imagePromptColumn.id),
              value: importedRow.imagePrompt,
            },
          });
          backfill.imagePrompt.successCount += 1;
        } catch {
          backfill.imagePrompt.failedCount += 1;
          backfill.imagePrompt.failedRows.push(importedRow.rowIndex);
        }
      }

      if (
        importedRow.videoPrompt &&
        videoPromptColumn?.id &&
        !isFieldValueEqual(importedRow.videoPrompt, persistedRow.videoPrompt)
      ) {
        await backendApi.post("/api/user/shotValue/input", {
          data: {
            shotId: persistedRow.shotId,
            shotColumnId: String(videoPromptColumn.id),
            value: importedRow.videoPrompt,
          },
        });
      }

      if (!importedRow.stylePlanting || !stylePlantingColumn?.id) {
        backfill.stylePlanting.skippedCount += 1;
      } else if (isFieldValueEqual(importedRow.stylePlanting, persistedRow.stylePlanting)) {
        backfill.stylePlanting.skippedCount += 1;
      } else {
        backfill.stylePlanting.attemptedCount += 1;
        try {
          await backendApi.post("/api/user/shotValue/input", {
            data: {
              shotId: persistedRow.shotId,
              shotColumnId: String(stylePlantingColumn.id),
              value: importedRow.stylePlanting,
            },
          });
          backfill.stylePlanting.successCount += 1;
        } catch {
          backfill.stylePlanting.failedCount += 1;
          backfill.stylePlanting.failedRows.push(importedRow.rowIndex);
        }
      }
    }

    if (params.autoload) {
      await runStoryboardColumnAutoload(columns, backfill);
    }
  } catch (error) {
    const fallbackMessage = error instanceof Error ? error.message : "画面描述补写失败";
    setFieldBackfillFailureState(
      backfill,
      importedRows,
      (row) => !!row.description,
      fallbackMessage
    );
    setFieldBackfillFailureState(
      backfill.scene,
      importedRows,
      (row) => !!row.scene,
      error instanceof Error ? error.message : "场景补写失败"
    );
    setFieldBackfillFailureState(
      backfill.character,
      importedRows,
      (_row, index) => (entityBackfillRows[index]?.characterIds?.length ?? 0) > 0,
      error instanceof Error ? error.message : "角色补写失败"
    );
    setFieldBackfillFailureState(
      backfill.prop,
      importedRows,
      (_row, index) => (entityBackfillRows[index]?.propIds?.length ?? 0) > 0,
      error instanceof Error ? error.message : "道具补写失败"
    );
    setFieldBackfillFailureState(
      backfill.imagePrompt,
      importedRows,
      (row) => !!row.imagePrompt,
      error instanceof Error ? error.message : "图片提示词补写失败"
    );
    setFieldBackfillFailureState(
      backfill.stylePlanting,
      importedRows,
      (row) => !!row.stylePlanting,
      error instanceof Error ? error.message : "画风补写失败"
    );
  }

  return {
    backfill,
    warning: getStoryboardBackfillWarning(backfill),
  };
}
