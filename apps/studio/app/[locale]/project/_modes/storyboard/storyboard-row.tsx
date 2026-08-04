"use client";

import { memo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  STORYBOARD_COLUMNS,
  STORYBOARD_GRID_TEMPLATE,
  STORYBOARD_ROW_RULE,
  storyboardCellClass,
  storyboardCellStyle,
} from "./storyboard-columns";
import type { StoryboardRowActions } from "./storyboard-types";
import type { ShotRow } from "./use-storyboard";

/**
 * One storyboard row: the column list, rendered.
 *
 * The row owns three things no cell can — the positioning, the fill, and the
 * drag handle it hands down:
 *
 *  • Positioning composes three layers. The virtualizer places the row
 *    (`translateY(start)`), the sortable layer offsets it while a drag reflows
 *    the list (`transform.y`), and its measured height feeds back through
 *    `measureRef` — which is what lets a row grow with a wrapped line of
 *    dialogue instead of being pinned to an estimate.
 *  • The fill lives here and nowhere else, so the pinned column (which inherits
 *    it) can never cut a seam across the row.
 *  • `useSortable` belongs to the row because the ROW is what reorders; the
 *    gutter cell just renders the affordance.
 */
export const StoryboardRow = memo(function StoryboardRow({
  row,
  index,
  rowCount,
  canEdit,
  selected,
  start,
  highlighted,
  measureRef,
  actions,
}: {
  row: ShotRow;
  /** Position in the board (0-based), for the virtualizer and reordering. */
  index: number;
  rowCount: number;
  canEdit: boolean;
  selected: boolean;
  start: number;
  highlighted: boolean;
  measureRef: (node: HTMLElement | null) => void;
  actions: StoryboardRowActions;
}) {
  const t = useTranslations("storyboard");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !canEdit,
  });

  // The virtualizer measures this node AND the sortable layer needs it.
  const setRefs = useCallback(
    (node: HTMLTableRowElement | null) => {
      setNodeRef(node);
      measureRef(node);
    },
    [measureRef, setNodeRef]
  );

  return (
    <TableRow
      ref={setRefs}
      data-index={index}
      style={{
        gridTemplateColumns: STORYBOARD_GRID_TEMPLATE,
        transform: `translate3d(0, ${start + (transform?.y ?? 0)}px, 0)`,
        transition,
      }}
      className={cn(
        // `w-max min-w-full`: the row spans the whole track list, not just the
        // viewport — a sticky cell can only travel inside its own row box, so a
        // `w-full` row would let the pinned column drift off once the board is
        // scrolled past one screen.
        "group/row absolute top-0 left-0 grid w-max min-w-full items-center [&>td]:flex [&>td]:h-full [&>td]:items-center",
        STORYBOARD_ROW_RULE,
        // Every row state is a SOLID tone, and it lives on the row alone: the
        // pinned cell inherits this fill. The values are `card` with the usual
        // white wash already mixed in (2.2% hover, 7% highlight) —
        // pre-composited, because a translucent fill inherited by the pinned
        // cell would let the columns sliding beneath it show through.
        "bg-card hover:bg-[oklch(0.1925_0_0)]",
        isDragging && "z-10 shadow-lg shadow-black/40",
        highlighted && "bg-[oklch(0.232_0_0)] hover:bg-[oklch(0.232_0_0)]"
      )}
    >
      {STORYBOARD_COLUMNS.map((column) => (
        <TableCell
          key={column.key}
          className={storyboardCellClass(column)}
          style={storyboardCellStyle(column)}
        >
          <column.Cell
            row={row}
            index={index}
            rowCount={rowCount}
            canEdit={canEdit}
            selected={selected}
            label={t(`column.${column.key}`)}
            handle={{ attributes, listeners }}
            actions={actions}
          />
        </TableCell>
      ))}
    </TableRow>
  );
});
