"use client";

import { useTextDraft } from "@/lib/use-text-draft";
import { cn } from "@/lib/utils";

const QUIET_CELL =
  "-mx-1.5 rounded-md px-1.5 transition-colors hover:bg-white/[0.05] focus-within:bg-white/[0.06]";

/** A multi-line text cell (dialogue / notes). */
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
