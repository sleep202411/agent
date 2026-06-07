import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "w-full min-w-0 rounded-md border border-input bg-input/20 transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      size: {
        sm: "h-7 px-2 py-0.5 text-sm md:text-xs/relaxed",
        default: "h-8 px-2.5 text-sm",
        lg: "h-9 px-2.5 text-sm",
      },
    },
    defaultVariants: { size: "sm" },
  }
);

export type InputProps = Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof inputVariants> & { showCount?: boolean };

/**
 * `showCount` opt-in renders a live `xx/max` counter centered on the right edge
 * when a `maxLength` is set — mirrors <Textarea>'s counter so callers stop
 * hand-placing a separate <CharacterCount>. It's a prop (not auto-on-maxLength)
 * on purpose: plenty of fields carry a maxLength without wanting a visible
 * counter. The counter needs the controlled `value` to count; uncontrolled
 * fields read as 0.
 */
function Input({ className, type, size, showCount, maxLength, value, ...props }: InputProps) {
  const field = (
    <input
      type={type}
      data-slot="input"
      maxLength={maxLength}
      value={value}
      className={cn(inputVariants({ size }), showCount && maxLength ? "pr-14" : null, className)}
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
          "pointer-events-none absolute bottom-1/2 right-2.5 -translate-y-1/2 text-[11px] tabular-nums",
          count >= maxLength ? "text-destructive" : "text-muted-foreground/60"
        )}
      >
        {count}/{maxLength}
      </span>
    </div>
  );
}

export { Input, inputVariants };
