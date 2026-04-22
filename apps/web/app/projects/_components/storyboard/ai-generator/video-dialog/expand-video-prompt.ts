/**
 * Video-prompt expansion client — collects row fields relevant to the
 * video generation (dialogue, movement, style, etc.), posts them to
 * `/aurora/video-prompt/expand` (Nest → Mastra → Qwen), and returns the
 * LLM-rewritten multi-shot prompt in the "第一镜头/第二镜头" format the
 * video dialog feeds to the video model.
 *
 * Scene/character cells render as mention HTML in the row; we extract
 * just the display text here so the LLM sees clean names instead of
 * `<mention id="…">`.
 */

import { stripAllTags } from "@/app/projects/_components/storyboard/cells/cell-utils";
import type { ShotColumn, ShotRow, ShotValue, Asset } from "@/src/store/slices/projectSlice";

export interface ExpandVideoPromptRequest {
  shotNumber?: number;
  durationSec?: number;
  currentPrompt?: string;
  movement?: string;
  stylePainting?: string;
  sceneName?: string;
  characters?: string[];
  dialogue?: string;
  subtitle?: string;
  action?: string;
  extraFields?: Record<string, string>;
}

const RELEVANT_PRESET_KEYS = new Set([
  "video_prompt",
  "movement",
  "style_planting",
  "dialogue",
  "subtitle",
  "description",
  "duration",
  "shot_size",
  "perspective",
]);

function cellPlainText(cell: ShotValue | undefined): string {
  if (!cell) return "";
  const richTextContent = cell.richText?.content;
  if (typeof richTextContent === "string" && richTextContent.trim()) {
    return stripAllTags(richTextContent).trim();
  }
  const raw =
    typeof cell.value === "string"
      ? cell.value
      : typeof (cell as { text?: unknown }).text === "string"
        ? String((cell as { text?: unknown }).text)
        : "";
  return stripAllTags(raw).trim();
}

export function buildExpandPayload(
  row: ShotRow,
  columns: ShotColumn[],
  shotNumber?: number
): ExpandVideoPromptRequest {
  const shotValues = row.shotValues ?? [];
  const out: ExpandVideoPromptRequest = {};
  if (typeof shotNumber === "number") out.shotNumber = shotNumber;

  const byPreset = new Map<string, ShotValue>();
  for (const cell of shotValues) {
    const preset = cell.presetColumnKey;
    if (preset) byPreset.set(preset, cell);
  }

  // Scene / character are relation cells — pull names out of the nested
  // asset objects rather than the mention HTML that cellPlainText would
  // produce.
  const sceneCell = byPreset.get("scene");
  const scene = (sceneCell?.scenes as Asset[] | undefined)?.[0];
  if (scene?.name) out.sceneName = String(scene.name);

  const characterCell = byPreset.get("character");
  const characters = (characterCell?.characters as Asset[] | undefined) ?? [];
  const characterNames = characters.map((c) => String(c?.name ?? "").trim()).filter(Boolean);
  if (characterNames.length) out.characters = characterNames;

  out.currentPrompt = cellPlainText(byPreset.get("video_prompt"));
  out.movement = cellPlainText(byPreset.get("movement"));
  out.stylePainting = cellPlainText(byPreset.get("style_planting"));
  out.dialogue = cellPlainText(byPreset.get("dialogue"));
  out.subtitle = cellPlainText(byPreset.get("subtitle"));
  out.action = cellPlainText(byPreset.get("description"));

  const durationRaw = cellPlainText(byPreset.get("duration"));
  const durationNumber = Number(durationRaw.replace(/[^\d.]/g, ""));
  if (Number.isFinite(durationNumber) && durationNumber > 0) {
    out.durationSec = durationNumber;
  }

  // Surface any other text-bearing preset cell the dialog knows about
  // (shot_size / perspective) as free-form hints — the backend template
  // merges them into the "其他" section without needing a schema update.
  const extras: Record<string, string> = {};
  for (const preset of ["shot_size", "perspective"]) {
    if (!RELEVANT_PRESET_KEYS.has(preset)) continue;
    const text = cellPlainText(byPreset.get(preset));
    if (!text) continue;
    const label = preset === "shot_size" ? "景别" : preset === "perspective" ? "视角" : preset;
    extras[label] = text;
  }
  if (Object.keys(extras).length) out.extraFields = extras;

  // Strip keys that came back empty so the Zod schema upstream doesn't
  // receive empty strings that add noise to the prompt.
  for (const key of Object.keys(out) as (keyof ExpandVideoPromptRequest)[]) {
    const v = out[key];
    if (typeof v === "string" && !v) delete out[key];
  }

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
