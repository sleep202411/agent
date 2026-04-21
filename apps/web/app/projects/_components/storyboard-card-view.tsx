"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ImageCell, MediaCell } from "@/app/projects/_components/storyboard/cells";
import { useTranslations } from "@/src/i18n/i18n";
import { fetchProjectDictionaries } from "@/src/lib/project-dictionaries";
import { useAppSelector } from "@/src/store";
import {
  selectCurrentInstance,
  type ShotColumn,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";

// Map of styleId → styleName for the project-level 画风 dictionary. Used
// as a fallback when a select column stores an id that isn't resolvable
// against its own columnOptions.
type StyleDict = Record<string, string>;

/**
 * Per-row card layout — parallel to the virtualized table view. Each card
 * is one shot rendered as:
 *
 *   [分镜图]  [分镜视频]  [其他信息 — all remaining columns flattened]
 *
 * Data shape is identical to the table view (ShotRow + ShotValue +
 * ShotColumn); difference is purely layout. Image / video / lipsync /
 * audio columns reuse the same cell components as the table so
 * interactions (upload, open, generate) stay consistent. Everything
 * else is flattened into a compact "label: value" list.
 */
export function StoryboardCardView() {
  const t = useTranslations("storyboard");
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);

  const [styleDict, setStyleDict] = useState<StyleDict>({});
  useEffect(() => {
    let active = true;
    fetchProjectDictionaries()
      .then((data) => {
        if (!active) return;
        const dict: StyleDict = {};
        for (const opt of data.styleOptions) {
          if (opt.id) dict[String(opt.id)] = String(opt.info ?? "");
        }
        setStyleDict(dict);
      })
      .catch(() => {
        // Soft-fail: card view will show raw ids for 画风 cells, same as
        // the table view does for any other unresolvable select.
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleColumns = columns
    .filter((column) => !column.hide)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  // Partition columns into the three slots. Image / video get their own
  // slots; everything else is merged into "其他信息". shot_no is dropped
  // because the card title already reads "分镜脚本 NN".
  const imageColumn = visibleColumns.find((c) => c.resolvedType === "image");
  const videoColumn = visibleColumns.find((c) => c.resolvedType === "video");
  const otherColumns = visibleColumns.filter(
    (c) => c.resolvedType !== "image" && c.resolvedType !== "video" && c.resolvedType !== "shot_no"
  );

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("noShotsData")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex flex-col gap-4 px-4 py-4">
        {rows.map((row, index) => (
          <StoryboardCard
            key={row.shotId ?? index}
            row={row}
            index={index}
            imageColumn={imageColumn}
            videoColumn={videoColumn}
            otherColumns={otherColumns}
            styleDict={styleDict}
          />
        ))}
      </div>
    </div>
  );
}

function StoryboardCard({
  row,
  index,
  imageColumn,
  videoColumn,
  otherColumns,
  styleDict,
}: {
  row: ShotRow;
  index: number;
  imageColumn: ShotColumn | undefined;
  videoColumn: ShotColumn | undefined;
  otherColumns: ShotColumn[];
  styleDict: StyleDict;
}) {
  const shotId = String(row.shotId ?? "");
  const title = `分镜脚本${String(index + 1).padStart(2, "0")}`;

  return (
    <div
      data-storyboard-shot-id={shotId}
      className="flex h-[240px] flex-col rounded-lg border border-border/60 bg-card p-4"
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <span className="text-[14px] font-medium text-foreground/90">{title}</span>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[220px_220px_1fr]">
        <CardSlot label="分镜图">
          {imageColumn ? (
            <div className="h-[140px] overflow-hidden rounded-md border border-border/40">
              <ImageCell
                cell={findCell(row, imageColumn)}
                shotId={shotId}
                shotColumnId={String(imageColumn.id ?? "")}
                row={row}
                column={imageColumn}
              />
            </div>
          ) : (
            <EmptySlot />
          )}
        </CardSlot>

        <CardSlot label="分镜视频">
          {videoColumn ? (
            <div className="h-[140px] overflow-hidden rounded-md border border-border/40">
              <MediaCell
                cell={findCell(row, videoColumn)}
                shotId={shotId}
                shotColumnId={String(videoColumn.id ?? "")}
                type="video"
                row={row}
                column={videoColumn}
              />
            </div>
          ) : (
            <EmptySlot />
          )}
        </CardSlot>

        <CardSlot label="其他信息">
          {otherColumns.length > 0 ? (
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {otherColumns.map((col) => (
                <InlineField
                  key={col.id ?? col.presetColumnKey}
                  label={getColumnLabel(col)}
                  value={getCellDisplayText(findCell(row, col), col, styleDict)}
                />
              ))}
            </div>
          ) : (
            <EmptySlot />
          )}
        </CardSlot>
      </div>
    </div>
  );
}

// ─── Slot helpers ─────────────────────────────────────────────────────

function CardSlot({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="flex h-[140px] items-center justify-center rounded-md border border-dashed border-border/40 text-xs text-muted-foreground">
      暂无
    </div>
  );
}

// ─── "其他信息" rendering ────────────────────────────────────────────
//
// Every non-media column is flattened to a single `<label>: <text>` line.
// Mutation is NOT supported here — card view is a read-mostly summary;
// users drop into list view (or click the row's action buttons once wired)
// to edit.

function InlineField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-[13px] leading-relaxed">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className="flex-1 text-foreground/90">{value || "—"}</span>
    </div>
  );
}

function findCell(row: ShotRow, col: ShotColumn): ShotValue | undefined {
  return row.shotValues?.find((value) => value.shotColumnId === col.id);
}

function getColumnLabel(col: ShotColumn): string {
  return col.columnName ?? col.presetColumnKey ?? "—";
}

/**
 * Extract a plain-text representation of a cell regardless of column type:
 *  - richtext / dialogue: strip HTML, collapse whitespace
 *  - character / scene: join names with comma
 *  - select: resolve id → option name when possible
 *  - lip_sync / sound_path / music: "已上传" when any file present, else ""
 *  - shot_no / number / text and everything else: raw value
 */
function getCellDisplayText(
  cell: ShotValue | undefined,
  col: ShotColumn,
  styleDict: StyleDict
): string {
  if (!cell) return "";

  switch (col.resolvedType) {
    case "richtext":
    case "dialogue": {
      const html = cell.richText?.content ?? cell.value ?? "";
      return stripHtml(String(html));
    }
    case "character": {
      return extractNames(cell.characters).join("、");
    }
    case "scene": {
      return extractNames(cell.scenes).join("、");
    }
    case "select": {
      if (!cell.value) return "";
      // Most select cells store the display NAME in cell.value (see
      // SelectCell.persistTextCell). Dictionary-backed columns like 画风
      // are an exception — they store the option id. Lookup order:
      //   1. column's own columnOptions (if backend embedded {id, name})
      //   2. project-level 画风 dictionary (styleDict)
      //   3. raw stored value (last resort)
      const raw = String(cell.value);
      const opts = Array.isArray(col.columnOptions) ? col.columnOptions : [];
      for (const opt of opts) {
        if (!opt || typeof opt !== "object") continue;
        const rec = opt as Record<string, unknown>;
        const optId = rec.id != null ? String(rec.id) : "";
        if (optId && optId === raw) {
          const name = rec.name ?? rec.info;
          if (typeof name === "string" && name) return name;
        }
      }
      if (styleDict[raw]) return styleDict[raw];
      return raw;
    }
    case "lip_sync":
    case "sound_path":
    case "music": {
      const files = cell.files;
      return Array.isArray(files) && files.length > 0 ? "已上传" : "";
    }
    default:
      return cell.richText?.content
        ? stripHtml(String(cell.richText.content))
        : String(cell.value ?? "");
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const names: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = rec.name ?? rec.roleName ?? rec.sceneName ?? rec.propName;
    if (typeof name === "string" && name.trim()) names.push(name.trim());
  }
  return names;
}
