import * as React from "react";
import { cn } from "@/lib/utils";
import { GlassRim } from "./glass-rim";

/**
 * The "AI glass" surface (DESIGN.md §3.1 + §3.2): a translucent neutral fill +
 * backdrop blur/saturate (the glass body) + the gradient rim-light edge (the
 * thing that makes it read as glass, not a flat dark box). Use for cards, stat
 * tiles, panels, and popovers in place of `border border-…` / flat `bg-card`.
 *
 * The rim is rendered as a masked overlay child, so this is always `relative`.
 */
export function FrostedPanel({
  className,
  rim = true,
  blur = true,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** The sanctioned gradient rim-light edge (on by default). */
  rim?: boolean;
  /** Backdrop blur + saturate for the frosted-glass body (on by default). */
  blur?: boolean;
}) {
  return (
    <div
      data-slot="frosted-panel"
      className={cn(
        "relative rounded-2xl bg-white/[0.04]",
        blur && "backdrop-blur-xl backdrop-saturate-150",
        className
      )}
      {...props}
    >
      {rim ? <GlassRim /> : null}
      {children}
    </div>
  );
}
