"use client";

import { memo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useSortable } from "@dnd-kit/sortable";
import {
  IconArrowDown,
  IconArrowUp,
  IconArtboard,
  IconDotsVertical,
  IconGripVertical,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconTrash,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ShotNodeData } from "@/lib/canvas-authoring/shot-node";
import { STORYBOARD_ROW_RULE, STORYBOARD_GRID_TEMPLATE } from "./storyboard-columns";
import { ShotDurationCell, ShotOptionCell, ShotTextCell } from "./storyboard-cells";
import { ShotPictureCell } from "./shot-picture-cell";
import type { ShotRow } from "./use-storyboard";

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
 * One storyboard row.
 *
 * It carries three layers of positioning that have to compose, not fight:
 * the virtualizer places it (`translateY(start)`), the sortable layer offsets it
 * while a drag reflows the list (`transform.y`), and its own measured height
 * feeds back to the virtualizer through `measureRef` — which is what lets a row
 * grow with a wrapped line of dialogue instead of being pinned to an estimate.
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

  const { onPatch, onDelete, onInsert, onMoveToIndex, onSelect, onOpenOnCanvas } = actions;

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
        "group/row absolute top-0 left-0 grid w-full items-center [&>td]:flex [&>td]:h-full [&>td]:items-center",
        STORYBOARD_ROW_RULE,
        isDragging && "z-10 shadow-lg shadow-black/40",
        highlighted && "[&>td]:bg-white/[0.07]"
      )}
    >
      <TableCell>
        <div className="flex items-center gap-0.5">
          {canEdit ? (
            <span
              {...attributes}
              {...listeners}
              aria-label={t("row.reorder")}
              title={t("row.reorder")}
              className="-ml-1.5 cursor-grab touch-none text-white/20 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
            >
              <IconGripVertical className="size-3.5" stroke={1.8} />
            </span>
          ) : null}
          <span className="text-xs font-medium text-white/45 tabular-nums">{row.number}</span>
        </div>
      </TableCell>

      <TableCell>
        <ShotPictureCell
          row={row}
          kind="image"
          selected={selected}
          onOpen={() => onSelect(row.id)}
        />
      </TableCell>
      <TableCell>
        <ShotPictureCell
          row={row}
          kind="video"
          selected={selected}
          onOpen={() => onSelect(row.id)}
        />
      </TableCell>

      <TableCell>
        <ShotOptionCell
          group="size"
          value={row.data.shotSize}
          ariaLabel={t("column.size")}
          readOnly={!canEdit}
          onCommit={(next) => onPatch(row.id, { shotSize: next })}
        />
      </TableCell>
      <TableCell>
        <ShotOptionCell
          group="angle"
          value={row.data.perspective}
          ariaLabel={t("column.angle")}
          readOnly={!canEdit}
          onCommit={(next) => onPatch(row.id, { perspective: next })}
        />
      </TableCell>
      <TableCell>
        <ShotOptionCell
          group="movement"
          value={row.data.movement}
          ariaLabel={t("column.movement")}
          readOnly={!canEdit}
          onCommit={(next) => onPatch(row.id, { movement: next })}
        />
      </TableCell>
      <TableCell>
        <ShotDurationCell
          value={row.data.durationSeconds}
          ariaLabel={t("column.duration")}
          readOnly={!canEdit}
          onCommit={(next) => onPatch(row.id, { durationSeconds: next })}
        />
      </TableCell>
      <TableCell>
        <ShotTextCell
          value={row.data.dialogue ?? ""}
          placeholder={t("cell.dialoguePlaceholder")}
          ariaLabel={t("column.dialogue")}
          readOnly={!canEdit}
          onCommit={(next) => onPatch(row.id, { dialogue: next || undefined })}
        />
      </TableCell>
      <TableCell>
        <ShotTextCell
          value={row.data.notes ?? ""}
          placeholder={t("cell.notesPlaceholder")}
          ariaLabel={t("column.notes")}
          readOnly={!canEdit}
          onCommit={(next) => onPatch(row.id, { notes: next || undefined })}
        />
      </TableCell>

      <TableCell>
        {/* The shot's stable identity — the row NUMBER moves when the board is
            reordered, this never does. It is what `?row=` / `?focus=` links and
            the copilot address a shot by, so it is copyable in one click. */}
        <button
          type="button"
          title={row.id}
          aria-label={t("row.copyId")}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(row.id)
              .then(() => toast.success(t("row.copiedId")));
          }}
          className="-mx-1 truncate rounded px-1 font-mono text-[10px] text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          {row.id.slice(0, 8)}
        </button>
      </TableCell>

      <TableCell className="px-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("row.actions")}
            className="flex size-7 items-center justify-center rounded-lg bg-white/[0.06] text-white/55 opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-white/[0.12] hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none data-[state=open]:opacity-100"
          >
            <IconDotsVertical className="size-3.5" stroke={1.8} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => onOpenOnCanvas(row.id)}>
              <IconArtboard className="size-4" stroke={1.7} />
              {t("frame.viewOnCanvas")}
            </DropdownMenuItem>
            {canEdit ? (
              <>
                <DropdownMenuSeparator />
                {/* The keyboard path for reordering — pointer drag is an
                    accelerator, never the only way to move a shot. */}
                <DropdownMenuItem
                  disabled={index === 0}
                  onSelect={() => onMoveToIndex(row.id, index - 1)}
                >
                  <IconArrowUp className="size-4" stroke={1.7} />
                  {t("row.moveUp")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index >= rowCount - 1}
                  onSelect={() => onMoveToIndex(row.id, index + 1)}
                >
                  <IconArrowDown className="size-4" stroke={1.7} />
                  {t("row.moveDown")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onInsert(index)}>
                  <IconRowInsertTop className="size-4" stroke={1.7} />
                  {t("row.insertAbove")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onInsert(index + 1)}>
                  <IconRowInsertBottom className="size-4" stroke={1.7} />
                  {t("row.insertBelow")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row.id)}>
                  <IconTrash className="size-4" stroke={1.7} />
                  {t("row.delete")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});
