import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The signature "AI glass" rim-light (DESIGN.md §3.2). A soft gradient hairline
 * masked to the element's very edge (`mask-composite: exclude`) so it catches
 * light on the border without being a hard 1px line — the thing that makes a
 * frosted surface read as glass rather than a flat dark box.
 *
 * Drop inside a `position: relative` element that has a border radius; the rim
 * inherits the radius. Conic by default (panels / pills, per §3.2); pass a
 * radial gradient for active-glow or a linear gradient for an active rail item.
 *
 * Mirrors `_pollo/glyphs.tsx` `GradientRing` — this is the app-wide shared copy.
 */
export const GLASS_CONIC =
  "conic-gradient(from 288deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 42%, rgba(255,255,255,0) 43%, rgba(255,255,255,0.06) 48%, rgba(255,255,255,0) 88%, rgba(255,255,255,0) 90%, rgba(255,255,255,0.16) 100%)";

export function GlassRim({
  gradient = GLASS_CONIC,
  width = "1px",
  className,
}: {
  gradient?: string;
  /** Ring thickness. */
  width?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", className)}
      style={{
        background: gradient,
        padding: width,
        WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
      }}
    />
  );
}
