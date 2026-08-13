"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ShotNumberCell } from "./shot-number-cell";
import { ShotPictureCell } from "./shot-picture-cell";
import { ShotIdCell, ShotMenuCell } from "./shot-meta-cells";
import { ShotDurationCell } from "./shot-duration-cell";
import { ShotOptionCell } from "./shot-option-cell";
import { ShotTextCell } from "./shot-text-cell";
import { ShotPromptCell } from "./shot-prompt-cell";
import type { StoryboardCellProps, StoryboardColumn } from "./storyboard-types";

// ── cell adapters ───────────────────────────────────────────────────────────

function ShotFrameCell({ row, selected, actions }: StoryboardCellProps) {
  return (
    <ShotPictureCell
      row={row}
      kind="image"
      selected={selected}
      onOpen={() => actions.onSelect(row.id, "image")}
    />
  );
}
function ShotClipCell({ row, selected, actions }: StoryboardCellProps) {
  return (
    <ShotPictureCell
      row={row}
      kind="video"
      selected={selected}
      onOpen={() => actions.onSelect(row.id, "video")}
    />
  );
}
function ShotSizeCell({ row, canEdit, label, actions }: StoryboardCellProps) {
  return (
    <ShotOptionCell
      group="size"
      value={row.data.shotSize}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { shotSize: next })}
    />
  );
}
function ShotAngleCell({ row, canEdit, label, actions }: StoryboardCellProps) {
  return (
    <ShotOptionCell
      group="angle"
      value={row.data.perspective}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { perspective: next })}
    />
  );
}
function ShotMovementCell({ row, canEdit, label, actions }: StoryboardCellProps) {
  return (
    <ShotOptionCell
      group="movement"
      value={row.data.movement}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { movement: next })}
    />
  );
}
function ShotDurationColumnCell({ row, canEdit, label, actions }: StoryboardCellProps) {
  return (
    <ShotDurationCell
      value={row.data.durationSeconds}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { durationSeconds: next })}
    />
  );
}
function ShotDialogueCell({ row, canEdit, label, actions }: StoryboardCellProps) {
  const t = useTranslations("storyboard");
  return (
    <ShotTextCell
      value={row.data.dialogue ?? ""}
      placeholder={t("cell.dialoguePlaceholder")}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { dialogue: next || undefined })}
    />
  );
}
function ShotNotesCell({ row, canEdit, label, actions }: StoryboardCellProps) {
  const t = useTranslations("storyboard");
  return (
    <ShotTextCell
      value={row.data.notes ?? ""}
      placeholder={t("cell.notesPlaceholder")}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { notes: next || undefined })}
    />
  );
}
function ShotDescriptionCell({
  row,
  canEdit,
  label,
  actions,
  cellId,
  onNavigate,
}: StoryboardCellProps) {
  const t = useTranslations("storyboard");
  return (
    <ShotPromptCell
      value={row.data.description}
      placeholder={t("cell.descriptionPlaceholder")}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { description: next || undefined })}
      cellId={cellId}
      onNavigate={onNavigate}
    />
  );
}
function ShotImagePromptCell({
  row,
  canEdit,
  label,
  actions,
  cellId,
  onNavigate,
}: StoryboardCellProps) {
  const t = useTranslations("storyboard");
  return (
    <ShotPromptCell
      value={row.data.imagePrompt}
      placeholder={t("cell.imagePromptPlaceholder")}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { imagePrompt: next || undefined })}
      cellId={cellId}
      onNavigate={onNavigate}
    />
  );
}
function ShotVideoPromptCell({
  row,
  canEdit,
  label,
  actions,
  cellId,
  onNavigate,
}: StoryboardCellProps) {
  const t = useTranslations("storyboard");
  return (
    <ShotPromptCell
      value={row.data.videoPrompt}
      placeholder={t("cell.videoPromptPlaceholder")}
      ariaLabel={label}
      readOnly={!canEdit}
      onCommit={(next) => actions.onPatch(row.id, { videoPrompt: next || undefined })}
      cellId={cellId}
      onNavigate={onNavigate}
    />
  );
}

// ── the columns ─────────────────────────────────────────────────────────────
// Fixed px widths — no fr/minmax. The table width is the sum, set explicitly
// so virtualized absolute body rows and the normal-flow header always match.

export const STORYBOARD_COLUMNS: readonly StoryboardColumn[] = [
  {
    key: "number",
    width: 100,
    align: "center",
    pin: "left",
    header: { kind: "glyph", glyph: "#" },
    Cell: ShotNumberCell,
  },
  { key: "frame", width: 160, header: { kind: "label" }, Cell: ShotFrameCell },
  { key: "clip", width: 160, header: { kind: "label" }, Cell: ShotClipCell },
  { key: "size", width: 112, header: { kind: "label" }, Cell: ShotSizeCell, editable: true },
  { key: "angle", width: 112, header: { kind: "label" }, Cell: ShotAngleCell, editable: true },
  {
    key: "movement",
    width: 112,
    header: { kind: "label" },
    Cell: ShotMovementCell,
    editable: true,
  },
  {
    key: "duration",
    width: 80,
    header: { kind: "label" },
    Cell: ShotDurationColumnCell,
    editable: true,
  },
  {
    key: "dialogue",
    width: 240,
    header: { kind: "label" },
    Cell: ShotDialogueCell,
    editable: true,
  },
  { key: "notes", width: 256, header: { kind: "label" }, Cell: ShotNotesCell, editable: true },
  {
    key: "description",
    width: 240,
    header: { kind: "label" },
    Cell: ShotDescriptionCell,
    editable: true,
  },
  {
    key: "imagePrompt",
    width: 240,
    header: { kind: "label" },
    Cell: ShotImagePromptCell,
    editable: true,
  },
  {
    key: "videoPrompt",
    width: 240,
    header: { kind: "label" },
    Cell: ShotVideoPromptCell,
    editable: true,
  },
  { key: "id", width: 96, header: { kind: "label" }, Cell: ShotIdCell },
  { key: "actions", width: 48, header: { kind: "hidden" }, Cell: ShotMenuCell },
];

/** CSS grid-template-columns string — every column as a fixed px value. */
export const STORYBOARD_GRID_TEMPLATE = STORYBOARD_COLUMNS.map((c) => `${c.width}px`).join(" ");

/** Total table width — the sum of all column widths. Set on the <table> so
 *  header (normal flow) and body (absolute virtualized rows) always match. */
export const STORYBOARD_TABLE_WIDTH = STORYBOARD_COLUMNS.reduce((sum, c) => sum + c.width, 0);

/** Keys of inline-editable columns (Tab stops here, others are skipped). */
export const EDITABLE_COLUMN_KEYS = STORYBOARD_COLUMNS.filter((c) => c.editable).map((c) => c.key);

/** Stable DOM id for a cell — used by grid focus navigation. */
export function cellDomId(rowId: string, columnKey: string): string {
  return `cell-${rowId}-${columnKey}`;
}

/** `left` offset for each pinned column (sum of widths in front of it). */
const PIN_OFFSETS: Record<string, number> = (() => {
  const offsets: Record<string, number> = {};
  let acc = 0;
  for (const column of STORYBOARD_COLUMNS) {
    if (!column.pin) break;
    offsets[column.key] = acc;
    acc += column.width;
  }
  return offsets;
})();

const ALIGN_CLASS = { center: "justify-center", end: "justify-end" } as const;

export function storyboardCellClass(column: StoryboardColumn, className?: string): string {
  return cn(
    "relative",
    column.align && ALIGN_CLASS[column.align],
    column.pin && "sticky z-10 bg-inherit",
    className
  );
}

export function storyboardHeadClass(column: StoryboardColumn, className?: string): string {
  return storyboardCellClass(
    column,
    cn("flex items-center justify-center", column.align && ALIGN_CLASS[column.align], className)
  );
}

export function storyboardCellStyle(column: StoryboardColumn): { left: string } | undefined {
  return column.pin ? { left: `${PIN_OFFSETS[column.key]}px` } : undefined;
}

export const STORYBOARD_ROW_RULE = "border-white/[0.09]";
export const STORYBOARD_ESTIMATED_ROW_HEIGHT = 100;
export const STORYBOARD_OVERSCAN = 8;
