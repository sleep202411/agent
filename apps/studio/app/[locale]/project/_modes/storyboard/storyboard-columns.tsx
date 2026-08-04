"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ShotNumberCell } from "./shot-number-cell";
import { ShotPictureCell } from "./shot-picture-cell";
import { ShotIdCell, ShotMenuCell } from "./shot-meta-cells";
import { ShotDurationCell, ShotOptionCell, ShotTextCell } from "./storyboard-cells";
import type { StoryboardCellProps, StoryboardColumn } from "./storyboard-types";

/**
 * The storyboard's columns — the ONE definition the header and every row walk.
 *
 * Virtualized rows are absolutely positioned, so real table layout (`colgroup` +
 * `table-fixed`) can't align them: the browser only sizes columns from cells it
 * lays out together, and a virtual window never holds a whole column. Header and
 * rows therefore share the grid track list below.
 *
 * Because a column carries its own `Cell`, header and body cannot disagree:
 * there is no hand-written list of `<td>`s to keep in the same order as the
 * tracks. Adding, moving, resizing or pinning a column is one edit here.
 *
 * The order of this array IS the order on screen.
 */

// ── cell adapters ───────────────────────────────────────────────────────────
// Each binds one column to the shot field it edits. They are the only place
// that knows "the 台词 column writes `dialogue`".

function ShotFrameCell({ row, selected, actions }: StoryboardCellProps) {
  return (
    <ShotPictureCell
      row={row}
      kind="image"
      selected={selected}
      onOpen={() => actions.onSelect(row.id)}
    />
  );
}

function ShotClipCell({ row, selected, actions }: StoryboardCellProps) {
  return (
    <ShotPictureCell
      row={row}
      kind="video"
      selected={selected}
      onOpen={() => actions.onSelect(row.id)}
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

// ── the columns ─────────────────────────────────────────────────────────────

export const STORYBOARD_COLUMNS: readonly StoryboardColumn[] = [
  {
    key: "number",
    track: "6.25rem",
    align: "center",
    pin: "left",
    header: { kind: "glyph", glyph: "#" },
    Cell: ShotNumberCell,
  },
  { key: "frame", track: "10rem", header: { kind: "label" }, Cell: ShotFrameCell },
  { key: "clip", track: "10rem", header: { kind: "label" }, Cell: ShotClipCell },
  { key: "size", track: "7rem", header: { kind: "label" }, Cell: ShotSizeCell },
  { key: "angle", track: "7rem", header: { kind: "label" }, Cell: ShotAngleCell },
  { key: "movement", track: "7rem", header: { kind: "label" }, Cell: ShotMovementCell },
  { key: "duration", track: "5rem", header: { kind: "label" }, Cell: ShotDurationColumnCell },
  {
    key: "dialogue",
    track: "minmax(12rem, 1fr)",
    header: { kind: "label" },
    Cell: ShotDialogueCell,
  },
  { key: "notes", track: "16rem", header: { kind: "label" }, Cell: ShotNotesCell },
  { key: "id", track: "6rem", header: { kind: "label" }, Cell: ShotIdCell },
  { key: "actions", track: "3rem", header: { kind: "hidden" }, Cell: ShotMenuCell },
];

export const STORYBOARD_GRID_TEMPLATE = STORYBOARD_COLUMNS.map((column) => column.track).join(" ");

/**
 * `left` offset for each pinned column: the sum of the tracks in front of it,
 * kept symbolic in a `calc()` so it follows the track list.
 *
 * Only a LEADING run can be pinned — pinning a column with unpinned ones before
 * it would need those to be sticky too.
 */
const PIN_OFFSETS: Record<string, string> = (() => {
  const offsets: Record<string, string> = {};
  const before: string[] = [];
  for (const column of STORYBOARD_COLUMNS) {
    if (!column.pin) break;
    offsets[column.key] = before.length > 0 ? `calc(${before.join(" + ")})` : "0px";
    before.push(column.track);
  }
  return offsets;
})();

const ALIGN_CLASS = { center: "justify-center", end: "justify-end" } as const;

/**
 * The cell chrome a column asks for — used by the header AND the row, so the
 * two can't drift.
 *
 * A pinned cell must be OPAQUE (the columns it holds back slide underneath it)
 * and takes its fill by inheritance rather than declaring one, so hover,
 * highlight and rest can never disagree across the pin's edge. That is why the
 * row's fills are solid tones: a translucent one would be inherited as
 * translucent and the moving columns would show straight through.
 */
export function storyboardCellClass(column: StoryboardColumn, className?: string): string {
  return cn(
    "relative",
    column.align && ALIGN_CLASS[column.align],
    column.pin && "sticky z-10 bg-inherit",
    className
  );
}

/**
 * The header's chrome. Same geometry as the cell below it, except that a header
 * CENTRES by default — a column name is a label for the whole column, not the
 * first thing in it. A column's own `align` still wins where it says so.
 */
export function storyboardHeadClass(column: StoryboardColumn, className?: string): string {
  return storyboardCellClass(
    column,
    cn("flex items-center justify-center", column.align && ALIGN_CLASS[column.align], className)
  );
}

export function storyboardCellStyle(column: StoryboardColumn): { left: string } | undefined {
  return column.pin ? { left: PIN_OFFSETS[column.key] } : undefined;
}

/**
 * Row rules only — horizontal hairlines, no column lines and no box. That is
 * DESIGN.md §4's one sanctioned "border" (a separator between rows), and it is
 * enough: alignment does the vertical work. Header and body share this so the
 * two can never drift apart.
 */
export const STORYBOARD_ROW_RULE = "border-white/[0.09]";

/**
 * Height the virtualizer reserves for a row it has not measured yet — one 16:9
 * thumbnail plus padding. Real heights are measured on mount (a wrapped line of
 * dialogue makes a row taller), so this only has to be close.
 */
export const STORYBOARD_ESTIMATED_ROW_HEIGHT = 100;

/** Rows kept mounted beyond the viewport, so scrolling doesn't flash blanks. */
export const STORYBOARD_OVERSCAN = 8;
