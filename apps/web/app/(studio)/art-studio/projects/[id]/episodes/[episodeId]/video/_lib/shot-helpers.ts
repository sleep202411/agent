/**
 * Pure helpers for the per-episode video editor.
 *
 * Cell access (`getCell` / `getText` / `getMediaPath`) reaches into a
 * Java-shaped `ShotRow` and pulls a single column's value out — the
 * Java payload nests rich text / file refs / scalar values
 * separately, so callers prefer these over poking the structure
 * directly. The mention helpers translate Java assets into the
 * `<mention>` HTML the RichMentionEditor / storyboard parsers
 * already understand, keeping the editor DOM consistent with
 * other prompt fields in the app.
 */

import { ossUrl } from "@/src/lib/asset-paths";
import type {
  ProduceJavaAsset,
  ProduceJavaAssetLists,
  ProduceShotColumn,
} from "@/src/lib/produce/java-produce-data";
import type { ShotRow, ShotValue } from "@/src/store/slices/projectSlice";
import type { MentionItem } from "@/app/projects/_components/storyboard/editor/mention-node";

export const EMPTY_ASSETS: ProduceJavaAssetLists = {
  character: [],
  scene: [],
  prop: [],
};

export function getCell(
  row: ShotRow | null | undefined,
  column?: ProduceShotColumn | null
): ShotValue | undefined {
  if (!row || !column?.id) return undefined;
  return row.shotValues?.find((value) => String(value.shotColumnId ?? "") === column.id);
}

export function getText(cell?: ShotValue): string {
  const richText = typeof cell?.richText?.content === "string" ? cell.richText.content : "";
  if (richText.trim()) return richText;
  return String(cell?.value ?? "");
}

export function getMediaPath(cell?: ShotValue): string {
  const files =
    (cell?.files as Array<{ path?: string; url?: string; preferred?: boolean }> | undefined) ?? [];
  const preferred = files.find((file) => file.preferred) ?? files[0];
  const pathFromValues = Array.isArray(cell?.values) ? String(cell.values[0] ?? "") : "";
  return String(preferred?.path ?? preferred?.url ?? cell?.value ?? pathFromValues ?? "");
}

export function findColumn(
  columns: ProduceShotColumn[],
  predicate: (column: ProduceShotColumn) => boolean
): ProduceShotColumn | null {
  return columns.find(predicate) ?? null;
}

export function columnLabel(column: ProduceShotColumn): string {
  return String(column.columnName ?? column.presetColumnKey ?? "");
}

export function makeMention(asset: ProduceJavaAsset): string {
  const mentionType =
    asset.kind === "character" ? "character" : asset.kind === "scene" ? "scene" : "prop";
  const imgUrl = asset.imagePaths[0] ? ossUrl(asset.imagePaths[0]) : "";
  return `<mention id="${asset.id}" type="${mentionType}" imgUrl="${imgUrl}">${asset.name}</mention>`;
}

export function buildMentionItems(assets: ProduceJavaAssetLists): MentionItem[] {
  return [...assets.character, ...assets.scene, ...assets.prop]
    .map((asset) => ({
      id: asset.id,
      label: asset.name,
      mentionType: asset.kind,
      imgUrl: asset.imagePaths[0] ? ossUrl(asset.imagePaths[0]) : "",
    }))
    .filter((item) => item.id && item.label);
}

/** Strip mention tags / HTML — used to validate that a prompt has
 *  meaningful text before we burn credits on video generation. */
export function displayPlainText(value: string): string {
  return value
    .replace(/<mention\s+[^>]*>([\s\S]*?)<\/mention>/g, "@$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * Mutate-by-shotId helper for the local rows[] state. Pure (returns
 * a new array); callers feed it into `setRows`. Keeps cell-level
 * editing logic in one place rather than scattered across event
 * handlers.
 */
export function updateRowCell(
  rows: ShotRow[],
  shotId: string,
  columnId: string,
  value: string
): ShotRow[] {
  return rows.map((row) => {
    if (String(row.shotId ?? "") !== shotId) return row;
    const shotValues = [...(row.shotValues ?? [])];
    const index = shotValues.findIndex((cell) => String(cell.shotColumnId ?? "") === columnId);
    const nextCell = {
      ...(index >= 0 ? shotValues[index] : {}),
      shotColumnId: columnId,
      value,
      richText: { content: value },
    };
    if (index >= 0) shotValues[index] = nextCell;
    else shotValues.push(nextCell);
    return { ...row, shotValues };
  });
}
