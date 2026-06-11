"use client";

import { toast } from "sonner";
import { cn } from "@/lib/utils";

const VARIANTS = {
  /** Pill action button, matching the chrome pill idiom (fills only, no borders). */
  pill: "flex h-8 items-center rounded-full bg-white/[0.06] px-3.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white",
  /** Quiet text button for low-emphasis row actions. */
  text: "rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
} as const;

/**
 * A row action whose feature has no backend yet. Honest UI: it never
 * pretends to work — it toasts "{label} · Coming soon" instead.
 */
export function ComingSoonButton({
  label,
  children,
  variant = "pill",
  className,
}: {
  /** Feature name used in the toast message. */
  label: string;
  /** Visible button text; defaults to the label. */
  children?: React.ReactNode;
  variant?: keyof typeof VARIANTS;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => toast.info(`${label} · Coming soon`)}
      className={cn(
        VARIANTS[variant],
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
    >
      {children ?? label}
    </button>
  );
}
