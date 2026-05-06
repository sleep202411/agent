"use client";

import { IconPhoto, IconPlayerPlay } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ossUrl } from "@/src/lib/asset-paths";
import type { ProduceShotColumn } from "@/src/lib/produce/java-produce-data";
import type { ShotRow } from "@/src/store/slices/projectSlice";
import { getCell, getMediaPath, getText } from "../_lib/shot-helpers";

interface ShotTimelineProps {
  rows: ShotRow[];
  selectedShotId: string;
  imageColumn: ProduceShotColumn | null;
  videoColumn: ProduceShotColumn | null;
  durationColumn: ProduceShotColumn | null;
  onSelect: (shotId: string) => void;
}

/**
 * Bottom horizontal-scroll thumbnail strip. Active shot ringed in
 * primary; click selects. Falls back to a placeholder photo icon
 * when neither video nor image is generated yet.
 */
export function ShotTimeline({
  rows,
  selectedShotId,
  imageColumn,
  videoColumn,
  durationColumn,
  onSelect,
}: ShotTimelineProps) {
  return (
    <footer className="shrink-0 border-t border-border/60 bg-background px-5 py-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <IconPlayerPlay className="size-3.5 fill-current text-foreground" />
        00:00 / {rows.length} 镜头
        <span className="ml-auto">多选</span>
      </div>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
        {rows.map((row, index) => {
          const shotId = String(row.shotId ?? "");
          const imagePath =
            getMediaPath(getCell(row, videoColumn)) || getMediaPath(getCell(row, imageColumn));
          const duration = getText(getCell(row, durationColumn)) || "5";
          const active = shotId === selectedShotId;
          return (
            <button
              key={shotId || index}
              type="button"
              onClick={() => shotId && onSelect(shotId)}
              className={cn(
                "relative w-44 shrink-0 overflow-hidden rounded-xl border bg-card text-left transition-colors",
                active
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border/60 hover:border-primary/50"
              )}
            >
              <div className="aspect-video bg-muted">
                {imagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ossUrl(imagePath)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <IconPhoto className="size-5 text-muted-foreground/45" />
                  </div>
                )}
              </div>
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                {index + 1}
              </span>
              <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                00:{String(duration).padStart(2, "0")}
              </span>
            </button>
          );
        })}
      </div>
    </footer>
  );
}
