"use client";

import { useTranslations } from "next-intl";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  shotOptionValues,
  useShotOptionLabel,
  type ShotOptionGroup,
} from "@/lib/canvas-authoring/use-shot-labels";
import { cn } from "@/lib/utils";

const QUIET_CELL =
  "-mx-1.5 rounded-md px-1.5 transition-colors hover:bg-white/[0.05] focus-within:bg-white/[0.06]";

/** One of the standard framing vocabularies (size / angle / movement). */
export function ShotOptionCell({
  group,
  value,
  ariaLabel,
  readOnly,
  onCommit,
  cellId,
  onNavigate,
}: {
  group: ShotOptionGroup;
  value: string | undefined;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: string | undefined) => void;
  cellId?: string;
  onNavigate?: (direction: "next" | "prev" | "down" | "up") => void;
}) {
  const t = useTranslations("storyboard");
  const optionLabel = useShotOptionLabel();
  const label = optionLabel(group, value);

  if (readOnly) {
    return (
      <span className={cn("text-xs/relaxed", label ? "text-white/75" : "text-white/25")}>
        {label ?? t("cell.unset")}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={cellId}
        aria-label={ariaLabel}
        className={cn(
          QUIET_CELL,
          "group/opt flex w-[calc(100%+0.75rem)] items-center gap-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/35",
          "data-[state=open]:bg-white/[0.06]"
        )}
        onKeyDown={(e) => {
          if (!onNavigate) return;
          if (e.key === "Tab") {
            e.preventDefault();
            onNavigate(e.shiftKey ? "prev" : "next");
          } else if (e.key === "Enter") {
            // Let Radix open the dropdown — but for grid nav when already open,
            // the item's onSelect handles it. When closed, Enter opens.
          }
        }}
      >
        <span
          className={cn(
            "flex-1 truncate text-xs/relaxed",
            label ? "text-white/85" : "text-white/25"
          )}
        >
          {label ?? t("cell.unset")}
        </span>
        <IconChevronDown
          className="size-3 shrink-0 text-white/30 opacity-0 transition-opacity group-hover/opt:opacity-100 group-data-[state=open]/opt:opacity-100"
          stroke={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem
          onSelect={() => {
            onCommit(undefined);
            onNavigate?.("next");
          }}
        >
          <IconCheck className={cn("size-3.5", value ? "opacity-0" : "opacity-100")} stroke={2} />
          <span className="text-white/50">{t("cell.unset")}</span>
        </DropdownMenuItem>
        {shotOptionValues(group).map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => {
              onCommit(option);
              onNavigate?.("next");
            }}
          >
            <IconCheck
              className={cn("size-3.5", value === option ? "opacity-100" : "opacity-0")}
              stroke={2}
            />
            {optionLabel(group, option)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
