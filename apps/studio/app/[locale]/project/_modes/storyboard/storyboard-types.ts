import type { ComponentType } from "react";
import type { useSortable } from "@dnd-kit/sortable";
import type { ShotNodeData } from "@/lib/canvas-authoring/shot-node";
import type { ShotRow } from "./use-storyboard";

/**
 * The contracts a storyboard column is written against.
 *
 * They live apart from the column list so the cell components can be typed by
 * them without importing the list that imports the cells.
 */

/** The drag affordance, handed down from the row's `useSortable`. */
export type ShotDragHandle = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

export interface StoryboardRowActions {
  onPatch: (shotId: string, patch: Partial<ShotNodeData>) => void;
  onDelete: (shotId: string) => void;
  onInsert: (index: number) => void;
  onMoveToIndex: (shotId: string, index: number) => void;
  /** Open this shot in the picture drawer (master-detail selection). */
  onSelect: (shotId: string) => void;
  onOpenOnCanvas: (nodeId: string) => void;
}

/**
 * What every cell receives. One shape for all columns: a cell reads what it
 * needs and ignores the rest, so adding a column never means threading a new
 * prop through the row.
 */
export interface StoryboardCellProps {
  row: ShotRow;
  /** Position in the board (0-based) — insert/move resolve against it. */
  index: number;
  rowCount: number;
  canEdit: boolean;
  /** Whether this shot is the one open in the picture drawer. */
  selected: boolean;
  /** The column's own header text; cells use it as their accessible name. */
  label: string;
  handle: ShotDragHandle;
  actions: StoryboardRowActions;
}

/**
 * A column — ONE object holding everything about it: how wide it is, how it
 * heads itself, whether it pins, and what its cell renders.
 *
 * This is the whole point of the module. The header and the row both walk this
 * list, so a column can't exist in one and be missing from the other, and its
 * track can't drift from its content. Adding a column is one entry here.
 */
export interface StoryboardColumn {
  key: string;
  /** CSS grid track (the header and every row share one track list). */
  track: string;
  align?: "center" | "end";
  /** Sticks to the leading edge while the board scrolls sideways. */
  pin?: "left";
  /**
   * `label` — the translated column name.
   * `glyph` — that symbol on screen, the name still spoken ("#", not "number
   *           sign").
   * `hidden` — nothing on screen, for a column whose content says what it is.
   * A header cell is emitted either way, or the header stops lining up.
   */
  header: { kind: "label" } | { kind: "glyph"; glyph: string } | { kind: "hidden" };
  Cell: ComponentType<StoryboardCellProps>;
}
