"use client";

import { useRef, useState } from "react";
import ReactPlayer from "react-player";
import { IconPhoto, IconVideo } from "@tabler/icons-react";
import {
  getPreferredFilePath,
  getVideoThumbnail,
  ossUrl,
} from "@/app/projects/_components/storyboard/cells/cell-utils";
import type { ShotValue } from "@/src/store/slices/projectSlice";

/**
 * Plain read-only media previews for the storyboard card view. No
 * buttons, no hover overlays, no dialog state — interactions come from
 * the card-level action row instead (see storyboard-card-action-row).
 */

export function CardImageSlot({ cell }: { cell: ShotValue | undefined }) {
  const path = getPreferredFilePath(cell);
  if (!path) {
    return <EmptySlot icon={<IconPhoto className="size-6" />} label="暂无分镜图" />;
  }
  const src = ossUrl(path);
  return (
    <div className="h-[140px] w-full overflow-hidden rounded-md border border-border/40 bg-background/40">
      <img src={src} alt="" className="h-full w-full object-cover" />
    </div>
  );
}

export function CardVideoSlot({ cell }: { cell: ShotValue | undefined }) {
  const [hovering, setHovering] = useState(false);
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const path = getPreferredFilePath(cell);

  if (!path) {
    return <EmptySlot icon={<IconVideo className="size-6" />} label="暂无分镜视频" />;
  }

  const src = ossUrl(path);
  const poster = getVideoThumbnail(path);

  // ReactPlayer v3 renders a native <video> under the hood; hover drives
  // BOTH play state and whether controls are visible, so the resting
  // card is a clean poster with no chrome and controls only appear
  // while the user is interacting. `muted` is required for the browser
  // to honour programmatic play() without a user gesture. On leave we
  // seek back to 0 so the next hover starts fresh.
  const handleEnter = () => setHovering(true);
  const handleLeave = () => {
    setHovering(false);
    const video = playerRef.current;
    if (video) video.currentTime = 0;
  };

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="relative h-[140px] w-full overflow-hidden rounded-md border border-border/40 bg-background/40"
    >
      <ReactPlayer
        ref={playerRef}
        src={src}
        playing={hovering}
        controls={hovering}
        muted
        playsInline
        preload="metadata"
        poster={poster}
        width="100%"
        height="100%"
        style={{ objectFit: "cover" }}
      />
    </div>
  );
}

function EmptySlot({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex h-[140px] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-background/20 text-muted-foreground/60">
      {icon}
      <span className="text-[11px]">{label}</span>
    </div>
  );
}
