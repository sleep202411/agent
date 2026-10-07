"use client";

import { useEffect, useRef, useState } from "react";
import { IconVideo } from "@tabler/icons-react";
import { useCanvasDocumentId } from "@/components/canvas/authoring/canvas-document-context";
import { useVideoPoster } from "@/components/media/use-video-poster";
import type { ShotRow } from "./use-storyboard";

export function playbackVideo(row: ShotRow | undefined) {
  return row?.pictures.find(
    (picture) => picture.kind === "video" && picture.status === "ready" && picture.url
  );
}

export function playbackMedia(row: ShotRow | undefined) {
  return (
    playbackVideo(row) ??
    row?.pictures.find(
      (p) =>
        p.kind === "image" && p.status === "ready" && p.url && p.edgeId === row.preferredFrameEdgeId
    ) ??
    row?.pictures.find((p) => p.kind === "image" && p.status === "ready" && p.url)
  );
}

/** Load video posters lazily; image selection matches playback and export. */
export function ShotThumbnail({ row }: { row: ShotRow }) {
  const media = playbackMedia(row);
  return media?.kind === "video" && media.url ? (
    <VideoThumbnail key={media.url} src={media.url} />
  ) : (
    <ThumbnailImage src={media?.url} />
  );
}

function VideoThumbnail({ src }: { src: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const documentId = useCanvasDocumentId();
  const poster = useVideoPoster(src, undefined, documentId, visible);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "80px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={container} className="flex size-full items-center justify-center">
      <ThumbnailImage src={poster.data?.status === "ready" ? poster.data.url : undefined} />
    </div>
  );
}

function ThumbnailImage({ src }: { src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src)
    return <IconVideo className="size-5 text-muted-foreground" aria-hidden="true" />;
  // Signed media and local poster URLs must stay on the authenticated media path.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      draggable={false}
      loading="lazy"
      className="size-full object-cover"
      onError={() => setFailedSrc(src)}
    />
  );
}
