"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import {
  IconFile,
  IconMusic,
  IconPhoto,
  IconPlayerPlayFilled,
  IconVideo,
} from "@tabler/icons-react";
import type { ConversationAttachmentPayload } from "@repo/shared/conversation";
import { cn } from "@/lib/utils";

type AttachmentMediaKind = ConversationAttachmentPayload["mediaKind"];

interface AttachmentVisualProps {
  name: string;
  mediaKind: AttachmentMediaKind;
  src?: string | null;
  className?: string;
  mediaClassName?: string;
  /** Compact tiles are used before send; timeline/context previews use cover. */
  compact?: boolean;
}

/**
 * One preview decision for every crew-chat attachment surface.
 *
 * Images and videos render their actual bytes. Any media decode/network
 * failure falls back to a deterministic file-type tile rather than leaving a
 * broken image icon. Documents/audio/unknown files intentionally start with
 * the file tile because the media service does not yet provide trustworthy
 * document thumbnails or audio artwork.
 */
export function AttachmentVisual({
  name,
  mediaKind,
  src,
  className,
  mediaClassName,
  compact = false,
}: AttachmentVisualProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const canPreview = Boolean(src) && (mediaKind === "image" || mediaKind === "video");
  const previewFailed = Boolean(src) && failedSrc === src;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-[#111318]",
        className
      )}
    >
      {!canPreview || previewFailed ? (
        <AttachmentFileTile name={name} mediaKind={mediaKind} compact={compact} />
      ) : mediaKind === "image" ? (
        <Image
          src={src!}
          alt={name}
          fill
          unoptimized
          sizes={compact ? "48px" : "(max-width: 640px) 80vw, 360px"}
          onError={() => setFailedSrc(src!)}
          className={cn("object-cover", mediaClassName)}
        />
      ) : (
        <VideoThumbnail
          key={src}
          src={src!}
          name={name}
          onError={() => setFailedSrc(src!)}
          className={mediaClassName}
        />
      )}
    </div>
  );
}

function VideoThumbnail({
  src,
  name,
  onError,
  className,
}: {
  src: string;
  name: string;
  onError: () => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frameReady, setFrameReady] = useState(false);

  return (
    <>
      <AttachmentFileTile name={name} mediaKind="video" compact />
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="metadata"
        aria-label={name}
        onLoadedMetadata={() => {
          const video = videoRef.current;
          if (!video) return;
          // Seeking a fraction past zero makes WebKit/Chromium request and
          // paint the first decodable frame without preloading the full clip.
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(0.1, video.duration / 2);
          }
        }}
        onLoadedData={() => setFrameReady(true)}
        onSeeked={() => setFrameReady(true)}
        onError={onError}
        className={cn(
          "absolute inset-0 size-full object-cover transition-opacity duration-150",
          frameReady ? "opacity-100" : "opacity-0",
          className
        )}
      />
      <span className="pointer-events-none absolute bottom-2 right-2 grid size-6 place-items-center rounded-full bg-black/65 text-white shadow-sm">
        <IconPlayerPlayFilled className="size-2.5" />
      </span>
    </>
  );
}

export function AttachmentFileTile({
  name,
  mediaKind,
  compact = false,
}: {
  name: string;
  mediaKind: AttachmentMediaKind;
  compact?: boolean;
}) {
  const extension = fileExtension(name);

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "flex size-full flex-col items-center justify-center text-[#858b95]",
        compact ? "gap-0.5" : "gap-2"
      )}
    >
      <AttachmentKindIcon kind={mediaKind} className={compact ? "size-4" : "size-7"} />
      {extension ? (
        <span
          className={cn(
            "max-w-[80%] truncate font-semibold uppercase tracking-[0.08em] text-[#666d78]",
            compact ? "text-[7px]" : "text-[9px]"
          )}
        >
          {extension}
        </span>
      ) : null}
    </span>
  );
}

export function AttachmentKindIcon({
  kind,
  className,
}: {
  kind: AttachmentMediaKind;
  className?: string;
}) {
  switch (kind) {
    case "image":
      return <IconPhoto className={className} />;
    case "video":
      return <IconVideo className={className} />;
    case "audio":
      return <IconMusic className={className} />;
    default:
      return <IconFile className={className} />;
  }
}

export function fileExtension(name: string): string | null {
  const basename = name.trim().split(/[\\/]/).pop() ?? "";
  const dot = basename.lastIndexOf(".");
  if (dot <= 0 || dot === basename.length - 1) return null;
  return basename.slice(dot + 1, dot + 9);
}
