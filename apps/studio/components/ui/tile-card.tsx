import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The home's card aesthetic (DESIGN.md §5, ref `_pollo` RecentProjects): a soft
 * rounded-2xl tile with a low-alpha rim-light, the label/meta BELOW it (never
 * inside), and a hover lift. Presentational only — wrap it in a `Link`/`button`
 * that carries the `group` class so the baked-in `group-hover` reacts:
 *
 *   <Link className="group block outline-none">
 *     <TileCard media={<img …/>} title={name} meta={editedAt} overlay={<Menu/>} />
 *   </Link>
 */
const ASPECT = {
  video: "aspect-video",
  square: "aspect-square",
  "4/3": "aspect-[4/3]",
} as const;

export function TileCard({
  media,
  title,
  meta,
  overlay,
  aspect = "video",
  className,
  tileClassName,
}: {
  media: React.ReactNode;
  title?: React.ReactNode;
  meta?: React.ReactNode;
  /** Absolutely-positioned content inside the tile (e.g. a ⋮ actions menu). */
  overlay?: React.ReactNode;
  aspect?: keyof typeof ASPECT;
  className?: string;
  tileClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5 text-left", className)}>
      <div
        className={cn(
          "relative grid place-items-center overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.07] transition group-hover:bg-white/[0.05]",
          ASPECT[aspect],
          tileClassName
        )}
      >
        {media}
        {overlay}
      </div>
      {title || meta ? (
        <div>
          {title ? <div className="truncate text-sm font-medium">{title}</div> : null}
          {meta ? <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
