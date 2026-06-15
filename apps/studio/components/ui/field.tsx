import { cn } from "@/lib/utils";

/**
 * Labeled form field — standardizes the label→control rhythm (and an optional
 * hint/error) so dialogs/settings don't hand-roll `space-y-*` per input. The
 * base `Input`/`Textarea` are sized compact for dense canvas chrome; in form
 * contexts pass `inputClassName`-style sizing (e.g. FIELD_CONTROL below).
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  /** Muted suffix after the label, e.g. "(optional)". */
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
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
