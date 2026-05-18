"use client";

import { useMemo, useState } from "react";
import { IconCheck, IconX } from "@tabler/icons-react";
import { IconPencil } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  parseColumnOptions,
  persistTextCell,
} from "@/app/(studio)/art-studio/projects/_components/storyboard/cells/cell-utils";
import { cn } from "@/lib/utils";
import type { ShotColumn, ShotRow, ShotValue } from "@/src/store/slices/projectSlice";

/**
 * Select-typed 其他信息 row (画风 / 视角 / 景别 / 状态 / 运镜 …). Mirrors
 * the list-view SelectCell's interaction: click the line → popover of
 * options. Selection persists immediately via persistTextCell (same
 * path as SelectCell), popover closes.
 *
 * Why a popover, not a dialog: the previous flow wrapped SelectCell in
 * a dialog, which then spawned its OWN popover — two layers of
 * over-chrome for a one-click decision. Lifting the popover up to the
 * card level removes the intermediate dialog entirely.
 */
export function SelectInlineField({
  label,
  row,
  column,
  cell,
  resolvedValue,
}: {
  label: string;
  row: ShotRow;
  column: ShotColumn;
  cell: ShotValue | undefined;
  /**
   * Pre-resolved display text — already run through the styleDict /
   * columnOptions fallback chain by the caller. Used to highlight the
   * current selection in the popover (matches on label, not raw id).
   */
  resolvedValue: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const options = useMemo(() => parseColumnOptions(column), [column]);

  const shotId = String(row.shotId ?? "");
  const shotColumnId = String(column.id ?? "");

  const filteredOptions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    if (!query) return options;
    return options.filter((opt) => opt.toLowerCase().includes(query));
  }, [options, inputValue]);

  const current = resolvedValue;
  const hasValue = Boolean(current);

  const handleSelect = (value: string) => {
    if (value !== current) {
      void persistTextCell(shotId, shotColumnId, value);
    }
    setOpen(false);
    setInputValue("");
  };

  const handleClear = () => {
    if (hasValue) {
      void persistTextCell(shotId, shotColumnId, "");
    }
    setOpen(false);
    setInputValue("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setInputValue("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex w-full cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-left text-[13px] leading-relaxed transition-colors hover:bg-muted/40"
        >
          <span className="shrink-0 text-muted-foreground">{label}:</span>
          <span
            className={hasValue ? "flex-1 text-foreground/90" : "flex-1 text-muted-foreground/60"}
          >
            {hasValue ? current : "None"}
          </span>
          <IconPencil className="mt-0.5 size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-56 p-0">
        <div className="p-1.5">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && inputValue.trim()) {
                e.preventDefault();
                handleSelect(inputValue.trim());
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search or enter"
            className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <div className="max-h-48 overflow-auto p-1">
          {filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleSelect(option)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent",
                option === current && "text-primary"
              )}
            >
              {option === current && <IconCheck className="size-3" />}
              <span className={option === current ? "" : "pl-5"}>{option}</span>
            </button>
          ))}
          {filteredOptions.length === 0 && !inputValue.trim() && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">No options</div>
          )}
        </div>
        {hasValue && (
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={handleClear}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
            >
              <IconX className="size-3" />
              <span>Clear</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
