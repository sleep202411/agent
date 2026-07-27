import { cn } from "@/lib/utils";
import { RequiredMark } from "@/components/ui/required-mark";

/**
 * Labeled form field — standardizes the label→control rhythm (and an optional
 * hint/error) so dialogs/settings don't hand-roll `space-y-*` per input. The
 * base `Input`/`Textarea` are sized compact for dense canvas chrome; in form
 * contexts pass `inputClassName`-style sizing (e.g. FIELD_CONTROL below).
 *
 * Two label rhythms exist by design: the default (`text-sm`, foreground) for
 * comfortable settings/forms, and `dense` (`text-xs`, muted) for compact
 * dialogs. `required` renders the brand-red asterisk (DESIGN.md rule 3) —
 * set it on every field whose value is mandatory in the submitted contract
 * (defaults included), and pair it with `aria-required` on the control.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  dense,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  /** Muted suffix after the label, e.g. "(optional)". */
  hint?: React.ReactNode;
  error?: string;
  /** Renders the brand-red RequiredMark after the label. */
  required?: boolean;
  /** Compact dialog rhythm: smaller, muted label. */
  dense?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <label
        htmlFor={htmlFor}
        className={cn("block font-medium", dense ? "text-xs text-white/58" : "text-sm")}
      >
        {label}
        {required ? <RequiredMark /> : null}
        {hint ? <span className="ml-1 font-normal text-muted-foreground">{hint}</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** Comfortable control sizing for form contexts (overrides the compact base). */
export const FIELD_CONTROL = "h-11 rounded-xl px-3.5 text-[15px] md:text-[15px]";
export const FIELD_CONTROL_TEXTAREA = "min-h-24 rounded-xl px-3.5 py-3 text-[15px] md:text-[15px]";
/** Comfortable button sizing for form/dialog footers (overrides the compact base). */
export const FIELD_BUTTON = "h-11 rounded-xl px-5 text-[15px] [&_svg]:size-4";
