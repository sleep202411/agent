"use client";

import { useTranslations } from "next-intl";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTextDraft } from "@/lib/use-text-draft";
import {
  shotOptionValues,
  useShotOptionLabel,
  type ShotOptionGroup,
} from "@/lib/canvas-authoring/use-shot-labels";
import { cn } from "@/lib/utils";

/**
 * Storyboard cells read as CONTENT, not as form controls: a value is plain text
 * until you touch it, and the affordance (fill, caret, chevron) appears on
 * hover/focus. Boxed inputs in every cell turn a board into a spreadsheet —
 * and boxes are what DESIGN.md rules out in the first place.
 */
const QUIET_CELL =
  "-mx-1.5 rounded-md px-1.5 transition-colors hover:bg-white/[0.05] focus-within:bg-white/[0.06]";

export function ShotTextCell({
  value,
  placeholder,
  ariaLabel,
  readOnly,
  onCommit,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: string) => void;
}) {
  const draft = useTextDraft(value, onCommit);
  if (readOnly) {
    return (
      <p className="text-xs/relaxed whitespace-pre-wrap text-white/75">
        {value || <span className="text-white/25">—</span>}
      </p>
    );
  }
  return (
    <textarea
      value={draft.value}
      onChange={(event) => draft.onChange(event.target.value)}
      onBlur={draft.flush}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={1}
      className={cn(
        QUIET_CELL,
        "field-sizing-content block max-h-28 w-[calc(100%+0.75rem)] resize-none bg-transparent py-1 text-xs/relaxed text-white/85 outline-none placeholder:text-white/25"
      )}
    />
  );
}

/** Seconds — stored as a number, shown with its unit only once it has one. */
export function ShotDurationCell({
  value,
  ariaLabel,
  readOnly,
  onCommit,
}: {
  value: number | undefined;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: number | undefined) => void;
}) {
  const t = useTranslations("storyboard");
  const draft = useTextDraft(value == null ? "" : String(value), (next) => {
    const parsed = Number.parseFloat(next.replace(",", "."));
    onCommit(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  });

  if (readOnly) {
    return (
      <span className="text-xs/relaxed tabular-nums text-white/75">
        {value == null ? (
          <span className="text-white/25">—</span>
        ) : (
          t("cell.durationValue", { seconds: value })
        )}
      </span>
    );
  }
  return (
    <span className={cn(QUIET_CELL, "inline-flex items-baseline gap-0.5 py-1")}>
      <input
        value={draft.value}
        onChange={(event) => draft.onChange(event.target.value)}
        onBlur={draft.flush}
        inputMode="decimal"
        placeholder="—"
        aria-label={ariaLabel}
        className="w-7 bg-transparent text-xs/relaxed tabular-nums text-white/85 outline-none placeholder:text-white/25"
      />
      {draft.value ? (
        <span className="text-[10px] text-white/35">{t("cell.durationUnit")}</span>
      ) : null}
    </span>
  );
}

/** One of the standard framing vocabularies (size / angle / movement). */
export function ShotOptionCell({
  group,
  value,
  ariaLabel,
  readOnly,
  onCommit,
}: {
  group: ShotOptionGroup;
  value: string | undefined;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: string | undefined) => void;
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
        aria-label={ariaLabel}
        className={cn(
          QUIET_CELL,
          "group/opt flex w-[calc(100%+0.75rem)] items-center gap-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/35",
          "data-[state=open]:bg-white/[0.06]"
        )}
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
        <DropdownMenuItem onSelect={() => onCommit(undefined)}>
          <IconCheck className={cn("size-3.5", value ? "opacity-0" : "opacity-100")} stroke={2} />
          <span className="text-white/50">{t("cell.unset")}</span>
        </DropdownMenuItem>
        {shotOptionValues(group).map((option) => (
          <DropdownMenuItem key={option} onSelect={() => onCommit(option)}>
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
