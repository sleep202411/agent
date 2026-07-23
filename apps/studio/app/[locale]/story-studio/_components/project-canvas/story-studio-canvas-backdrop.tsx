import { cn } from "@/lib/utils";

export const STORY_STUDIO_CANVAS_BACKGROUND_COLOR = "oklch(0.18 0 0)";

const STORY_STUDIO_CANVAS_DOT_PATTERN =
  "radial-gradient(circle, rgb(255 255 255 / 0.13) 1px, transparent 1.2px)";

export function StoryStudioCanvasBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        backgroundColor: STORY_STUDIO_CANVAS_BACKGROUND_COLOR,
        backgroundImage: STORY_STUDIO_CANVAS_DOT_PATTERN,
        backgroundSize: "20px 20px",
      }}
    />
  );
}
