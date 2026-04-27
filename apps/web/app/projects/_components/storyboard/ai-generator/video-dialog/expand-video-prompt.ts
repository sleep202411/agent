/**
 * Video-prompt expansion client — serialises the entire current
 * storyboard row (every visible, non-media column the user has typed
 * into) and posts it to `/aurora/video-prompt/expand` (Nest → Mastra →
 * Qwen). Returns the LLM-rewritten multi-shot prompt in the
 * "第一镜头/第二镜头" format the video dialog feeds to the video model.
 *
 * We deliberately don't whitelist preset keys: users can add custom
 * columns (动作、情绪、镜头注释…) and those should influence the
 * expanded prompt too. Everything text-bearing is emitted as
 * "<columnName>: <plainText>" for the backend prompt to merge.
 *
 * Media columns (image / video / audio) get a "<columnName>: (已上传 N 张图)"
 * hint instead of the raw paths so Qwen knows they exist without us
 * dumping CDN URLs into the LLM context.
 */

import { stripNonMentionTags } from "@/app/projects/_components/storyboard/cells/cell-utils";
import type { ShotColumn, ShotRow, ShotValue, Asset } from "@/src/store/slices/projectSlice";

export interface ExpandVideoPromptRequest {
  shotNumber?: number;
  durationSec?: number;
  currentPrompt?: string;
  sceneName?: string;
  characters?: string[];
  /**
   * Free-form "<column label>: <plain text>" map harvested from the row.
   * Keys are column display names (falling back to presetColumnKey) so
   * the LLM sees human-readable headings like "运镜"、"对白"、"画风".
   */
  fields?: Record<string, string>;
}

/**
 * Column types that we already surface via structured fields (scene /
 * character) or that don't carry narrative signal (media paths) — skip
 * them when building the generic `fields` map to avoid duplication /
 * noise.
 */
const EXCLUDED_COLUMN_TYPES = new Set(["SCENE", "CHARACTER", "IMAGE", "VIDEO", "AUDIO", "MUSIC"]);

const EXCLUDED_PRESET_KEYS = new Set([
  "scene",
  "character",
  "image_path",
  "video_path",
  "video_path_lip_sync",
  "sound_path",
  "music",
  "status",
  "shot_no",
  // Already surfaced via structured fields below:
  "duration",
  "video_prompt",
]);

function cellPlainText(cell: ShotValue | undefined): string {
  if (!cell) return "";
  const richTextContent = cell.richText?.content;
  if (typeof richTextContent === "string" && richTextContent.trim()) {
    return stripNonMentionTags(richTextContent).trim();
  }
  const raw =
    typeof cell.value === "string"
      ? cell.value
      : typeof (cell as { text?: unknown }).text === "string"
        ? String((cell as { text?: unknown }).text)
        : "";
  return stripNonMentionTags(raw).trim();
}

function columnLabel(column: ShotColumn | undefined, fallback: string): string {
  const name = typeof column?.columnName === "string" ? column.columnName.trim() : "";
  if (name) return name;
  return fallback;
}

export function buildExpandPayload(
  row: ShotRow,
  columns: ShotColumn[],
  shotNumber?: number
): ExpandVideoPromptRequest {
  const shotValues = row.shotValues ?? [];
  const out: ExpandVideoPromptRequest = {};
  if (typeof shotNumber === "number") out.shotNumber = shotNumber;

  const columnById = new Map<string, ShotColumn>();
  for (const col of columns) {
    const id = col.id ? String(col.id) : "";
    if (id) columnById.set(id, col);
  }

  // Structured extracts (duration / scene / character / video_prompt) that
  // the backend prompt template treats as first-class slots.
  for (const cell of shotValues) {
    const preset = cell.presetColumnKey;

    if (preset === "scene") {
      const scene = (cell.scenes as Asset[] | undefined)?.[0];
      if (scene?.name) out.sceneName = String(scene.name);
      continue;
    }
    if (preset === "character") {
      const chars = (cell.characters as Asset[] | undefined) ?? [];
      const names = chars.map((c) => String(c?.name ?? "").trim()).filter(Boolean);
      if (names.length) out.characters = names;
      continue;
    }
    if (preset === "video_prompt") {
      const text = cellPlainText(cell);
      if (text) out.currentPrompt = text;
      continue;
    }
    if (preset === "duration") {
      const raw = cellPlainText(cell);
      const n = Number(raw.replace(/[^\d.]/g, ""));
      if (Number.isFinite(n) && n > 0) out.durationSec = n;
      continue;
    }
  }

  // Generic pass: every remaining text-bearing column ends up in `fields`
  // keyed by the column display name, so custom columns contribute too.
  const fields: Record<string, string> = {};
  for (const cell of shotValues) {
    const preset = cell.presetColumnKey ?? "";
    if (EXCLUDED_PRESET_KEYS.has(preset)) continue;

    const column = cell.shotColumnId ? columnById.get(String(cell.shotColumnId)) : undefined;
    const columnType = column?.columnType?.toUpperCase() ?? "";
    if (EXCLUDED_COLUMN_TYPES.has(columnType)) continue;

    const text = cellPlainText(cell);
    if (!text) continue;

    const label = columnLabel(column, preset || String(cell.shotColumnId ?? "field"));
    if (!fields[label]) fields[label] = text;
  }
  if (Object.keys(fields).length) out.fields = fields;

  return out;
}

export async function expandVideoPrompt(payload: ExpandVideoPromptRequest): Promise<string> {
  const response = await fetch("/aurora/video-prompt/expand", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text.slice(0, 200) || `expand failed: ${response.status}`);
  }
  const data = (await response.json()) as { prompt?: string };
  if (!data.prompt) throw new Error("empty prompt from server");
  return data.prompt;
}

// ─── Translate ────────────────────────────────────────

export type PromptLang = "zh" | "en";

/**
 * Heuristic prompt-language detection. CJK unified ideographs / kana /
 * CJK punctuation count vs ASCII letter count — whichever wins is the
 * source language. Treats mixed prompts as Chinese when the CJK count
 * matches latin letters because Chinese characters carry far more
 * meaning per glyph than letters do per latin word.
 */
export function detectPromptLanguage(text: string): PromptLang {
  if (!text) return "en";
  // Strip <mention> tags whole (tag + inner) before counting:
  // their attrs (id / type / imgUrl) carry heavy ASCII that would
  // otherwise tip the counter toward English on Chinese prompts.
  const cleaned = text.replace(/<mention\s[^>]*>[\s\S]*?<\/mention>/g, "");
  const cjk = (cleaned.match(/[\u4E00-\u9FFF\u3040-\u30FF\u3000-\u303F\uF900-\uFAFF]/g) ?? [])
    .length;
  const latin = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  return cjk >= latin ? "zh" : "en";
}

export interface TranslateVideoPromptRequest {
  prompt: string;
  sourceLang: PromptLang;
  targetLang: PromptLang;
}

export async function translateVideoPrompt(payload: TranslateVideoPromptRequest): Promise<string> {
  const response = await fetch("/aurora/video-prompt/translate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text.slice(0, 200) || `translate failed: ${response.status}`);
  }
  const data = (await response.json()) as { prompt?: string };
  if (!data.prompt) throw new Error("empty prompt from server");
  return data.prompt;
}
