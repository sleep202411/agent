import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * `showCount` opt-in renders a live `xx/max` counter in the bottom-right when a
 * `maxLength` is set — so callers stop hand-placing a separate <CharacterCount>.
 * It's a prop (not auto-on-maxLength) on purpose: plenty of fields carry a
 * maxLength without wanting a visible counter, and many already render their own,
 * so auto would double-count / leak counters into search boxes. The counter
 * needs the controlled `value` to count; uncontrolled fields read as 0.
 */
function Textarea({
  className,
  showCount,
  maxLength,
  value,
  ...props
}: React.ComponentProps<"textarea"> & { showCount?: boolean }) {
  const field = (
    <textarea
      data-slot="textarea"
      maxLength={maxLength}
      value={value}
      className={cn(
        "flex field-sizing-content min-h-16 w-full max-w-full resize-none rounded-md border border-input bg-input/20 px-2 py-2 text-sm transition-colors outline-none wrap-anywhere placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-xs/relaxed dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        showCount && maxLength ? "pb-7" : null,
        className
      )}
      {...props}
    />
  );

  if (!showCount || !maxLength) return field;

  const count = typeof value === "string" ? value.length : 0;
  return (
    <div className="relative w-full">
      {field}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-2 right-2.5 text-[11px] tabular-nums",
          count >= maxLength ? "text-destructive" : "text-muted-foreground/60"
        )}
      >
        {count}/{maxLength}
      </span>
    </div>
  );
}

export { Textarea };
