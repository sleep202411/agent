"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  IconArrowDown,
  IconArrowUp,
  IconArtboard,
  IconDotsVertical,
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
import type { StoryboardCellProps } from "./storyboard-types";

/**
 * The shot's stable identity. The row NUMBER moves when the board is reordered;
 * this never does — it is what `?row=` / `?focus=` links and the copilot address
 * a shot by, so it is copyable in one click.
 */
export function ShotIdCell({ row }: StoryboardCellProps) {
  const t = useTranslations("storyboard");
  return (
    <button
      type="button"
      title={row.id}
      aria-label={t("row.copyId")}
      onClick={() => {
        void navigator.clipboard?.writeText(row.id).then(() => toast.success(t("row.copiedId")));
      }}
      className="-mx-1 truncate rounded px-1 font-mono text-[10px] text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
    >
      {row.id.slice(0, 8)}
    </button>
  );
}

/**
 * The row's full command list. Everything here that also sits in the number
 * gutter is duplicated ON PURPOSE: the gutter is a pointer accelerator, this
 * menu is the complete, keyboard-reachable set.
 */
export function ShotMenuCell({ row, index, rowCount, canEdit, actions }: StoryboardCellProps) {
  const t = useTranslations("storyboard");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("row.actions")}
        className="flex size-7 items-center justify-center rounded-lg bg-white/[0.06] text-white/55 opacity-0 transition-colors group-hover/row:opacity-100 hover:bg-white/[0.12] hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none data-[state=open]:opacity-100"
      >
        <IconDotsVertical className="size-3.5" stroke={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => actions.onOpenOnCanvas(row.id)}>
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
              onSelect={() => actions.onMoveToIndex(row.id, index - 1)}
            >
              <IconArrowUp className="size-4" stroke={1.7} />
              {t("row.moveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index >= rowCount - 1}
              onSelect={() => actions.onMoveToIndex(row.id, index + 1)}
            >
              <IconArrowDown className="size-4" stroke={1.7} />
              {t("row.moveDown")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.onInsert(index)}>
              <IconRowInsertTop className="size-4" stroke={1.7} />
              {t("row.insertAbove")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onInsert(index + 1)}>
              <IconRowInsertBottom className="size-4" stroke={1.7} />
              {t("row.insertBelow")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(row.id)}>
              <IconTrash className="size-4" stroke={1.7} />
              {t("row.delete")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
