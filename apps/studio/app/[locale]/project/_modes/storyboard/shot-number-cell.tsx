"use client";

import { useTranslations } from "next-intl";
import {
  IconGripVertical,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconTrash,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { StoryboardCellProps } from "./storyboard-types";

/**
 * The storyboard's left gutter: the shot number at rest, the row's own three
 * actions on hover.
 *
 * The grip and the action cluster are both absolute, so neither reserves width
 * — that is what keeps the number on the column's true centre at rest and stops
 * it shifting when the row is hovered. They occupy separate lanes on purpose:
 * this cluster paints later, so an overlap would cover the grip and swallow its
 * clicks.
 *
 * Every action here is also in the row menu; this is the accelerator.
 */
export function ShotNumberCell({ row, index, canEdit, handle, actions }: StoryboardCellProps) {
  const t = useTranslations("storyboard");

  return (
    <>
      {canEdit ? (
        <span
          {...handle.attributes}
          {...handle.listeners}
          aria-label={t("row.reorder")}
          title={t("row.reorder")}
          className="absolute top-1/2 left-0.5 -translate-y-1/2 cursor-grab touch-none text-white/40 opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-white/70 focus-visible:opacity-100 active:cursor-grabbing"
        >
          <IconGripVertical className="size-3.5" stroke={1.8} />
        </span>
      ) : null}

      <span
        className={cn(
          "text-xs font-medium text-white/45 tabular-nums transition-opacity",
          canEdit && "group-hover/row:opacity-0"
        )}
      >
        {row.number}
      </span>

      {/* Hidden at rest means hidden to the POINTER too — `opacity-0` alone
          still takes clicks. Keyboard focus reveals it as well, so the cluster
          isn't mouse-only. */}
      {canEdit ? (
        <div className="pointer-events-none absolute inset-y-0 right-0.5 left-5 flex items-center justify-center gap-0.5 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <GutterAction label={t("row.insertAbove")} onClick={() => actions.onInsert(index)}>
            <IconRowInsertTop className="size-3.5" stroke={1.7} />
          </GutterAction>
          <GutterAction
            label={t("row.delete")}
            destructive
            onClick={() => actions.onDelete(row.id)}
          >
            <IconTrash className="size-3.5" stroke={1.7} />
          </GutterAction>
          <GutterAction label={t("row.insertBelow")} onClick={() => actions.onInsert(index + 1)}>
            <IconRowInsertBottom className="size-3.5" stroke={1.7} />
          </GutterAction>
        </div>
      ) : null}
    </>
  );
}

/** One icon action in the gutter — square, quiet, its label as the tooltip. */
function GutterAction({
  label,
  destructive,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        destructive
          ? "hover:bg-destructive/15 hover:text-destructive"
          : "hover:bg-white/[0.12] hover:text-white"
      )}
    >
      {children}
    </button>
  );
}
