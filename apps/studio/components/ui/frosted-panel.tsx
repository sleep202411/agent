import * as React from "react";
import { cn } from "@/lib/utils";
import { GlassRim } from "./glass-rim";

/**
 * The "AI glass" surface (DESIGN.md §3.1 + §3.2): a translucent neutral fill +
 * backdrop blur/saturate (the glass body) + the gradient rim-light edge (the
 * thing that makes it read as glass, not a flat dark box). Reserve it for
 * genuinely elevated content cards, stat tiles, panels, and popovers. Page
 * sections, empty states, and ordinary content groups stay transparent.
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
