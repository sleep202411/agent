import { cn } from "@/lib/utils";

const CANVAS_DOT_PATTERN =
  "radial-gradient(circle, var(--canvas-dot-color) 1px, transparent 1.2px)";

/**
 * Screen-space canvas backdrop shared by every authoring surface.
 *
 * This layer deliberately sits outside React Flow's transformed viewport, so
 * its dot size and spacing stay visually stable while content pans and zooms.
 */
export function CanvasBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="canvas-backdrop"
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        backgroundColor: "var(--canvas-background)",
        backgroundImage: CANVAS_DOT_PATTERN,
        backgroundSize: "var(--canvas-dot-spacing) var(--canvas-dot-spacing)",
      }}
    />
  );
}
