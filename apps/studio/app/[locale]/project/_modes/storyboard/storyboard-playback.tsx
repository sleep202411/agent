"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconChevronLeft, IconChevronRight, IconPlayerPlay } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCanvasDocumentId } from "@/components/canvas/authoring/canvas-document-context";
import { useMediaPlaybackSource } from "@/components/media/use-media-playback-source";
import { cn } from "@/lib/utils";
import { ShotThumbnail, playbackMedia } from "./shot-thumbnail";
import type { ShotRow } from "./use-storyboard";

/** Playback is a projection of saved shots, never another timeline document. */
export function StoryboardPlayback({ rows }: { rows: ShotRow[] }) {
  return (
    <Dialog>
      <PlaybackTrigger disabled={!rows.length} />
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-5xl"
        aria-describedby={undefined}
      >
        <PlaybackHeading />
        <StoryboardSequence rows={rows} />
      </DialogContent>
    </Dialog>
  );
}

function PlaybackTrigger({ disabled }: { disabled: boolean }) {
  const t = useTranslations("storyboard.playback");
  return (
    <DialogTrigger asChild>
      <Button variant="secondary" size="sm" disabled={disabled}>
        <IconPlayerPlay data-icon="inline-start" />
        {t("open")}
      </Button>
    </DialogTrigger>
  );
}
function PlaybackHeading() {
  const t = useTranslations("storyboard.playback");
  return <DialogTitle className="pr-8">{t("title")}</DialogTitle>;
}

export function StoryboardSequence({ rows }: { rows: ShotRow[] }) {
  const t = useTranslations("storyboard.playback");
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? null);
  const [playing, setPlaying] = useState(false);
  const index = Math.max(
    0,
    rows.findIndex((row) => row.id === selectedId)
  );
  const shot = rows[index];
  // Match the export selection: first ready video, otherwise preferred still.
  const video = playbackMedia(shot);
  const select = (next: number, resume = false) => {
    if (!rows[next]) return;
    setSelectedId(rows[next].id);
    setPlaying(resume);
  };
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg bg-black">
        {video?.url ? (
          <SequenceMedia
            key={`${shot.id}:${video.edgeId}:${video.url}`}
            src={video.url}
            still={video.kind === "image"}
            autoPlay={playing}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              if (index + 1 < rows.length) select(index + 1, true);
              else setPlaying(false);
            }}
          />
        ) : (
          <div
            className="flex aspect-video max-h-[65dvh] w-full items-center justify-center px-6 text-center text-sm text-muted-foreground"
            role="status"
          >
            {t("missing")}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={index === 0 || !shot}
          onClick={() => select(index - 1)}
          aria-label={t("previous")}
        >
          <IconChevronLeft />
        </Button>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("position", { current: shot ? index + 1 : 0, count: rows.length })}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={!shot || index === rows.length - 1}
          onClick={() => select(index + 1)}
          aria-label={t("next")}
        >
          <IconChevronRight />
        </Button>
      </div>
      <div className="flex shrink-0 gap-2 overflow-x-auto pb-1" aria-label={t("shots")}>
        {rows.map((row, rowIndex) => {
          return (
            <button
              key={row.id}
              type="button"
              aria-current={index === rowIndex ? "true" : undefined}
              aria-label={t("shot", { number: rowIndex + 1 })}
              onClick={() => select(rowIndex)}
              className={cn(
                "relative flex aspect-video w-28 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2",
                index === rowIndex && "text-foreground outline outline-2 outline-primary"
              )}
            >
              <ShotThumbnail row={row} />
              <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1.5 py-0.5 text-white">
                {rowIndex + 1}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SequenceMedia({
  still,
  src,
  autoPlay,
  onPlay,
  onPause,
  onEnded,
}: {
  still: boolean;
  src: string;
  autoPlay: boolean;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
}) {
  const t = useTranslations("storyboard.playback");
  const documentId = useCanvasDocumentId();
  const source = useMediaPlaybackSource(src, true, undefined, documentId);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const remaining = useRef(5000);
  useEffect(() => {
    if (!still || !autoPlay || failed || source.error || !source.src || loadedSrc !== source.src)
      return;
    const started = performance.now();
    let finished = false;
    const timer = window.setTimeout(() => {
      finished = true;
      remaining.current = 5000;
      onEnded();
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (!finished)
        remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [still, autoPlay, failed, source.error, source.src, loadedSrc, onEnded]);
  if (failed || source.error)
    return (
      <div
        role="alert"
        className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center text-sm"
      >
        <p>{source.error instanceof Error ? source.error.message : t("error")}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await source.refresh();
            setLoadedSrc(null);
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          {t("retry")}
        </Button>
      </div>
    );
  if (!source.src)
    return (
      <div
        role="status"
        className="flex aspect-video w-full items-center justify-center text-sm text-muted-foreground"
      >
        {t("loading")}
      </div>
    );
  if (still)
    return (
      <div className="relative w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={attempt}
          src={source.src}
          alt={t("image")}
          className="aspect-video max-h-[65dvh] w-full object-contain"
          onLoad={() => setLoadedSrc(source.src!)}
          onError={() => {
            setLoadedSrc(null);
            setFailed(true);
            onPause();
          }}
        />
        <div className="flex items-center justify-center gap-3 p-2">
          <Button variant="secondary" size="sm" onClick={autoPlay ? onPause : onPlay}>
            {t(autoPlay ? "pause" : "play")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("stillDuration")}</span>
        </div>
      </div>
    );
  return (
    <video
      key={attempt}
      src={source.src}
      controls
      playsInline
      autoPlay={autoPlay}
      preload="metadata"
      className="aspect-video max-h-[65dvh] w-full object-contain"
      aria-label={t("video")}
      onPlay={onPlay}
      onPause={onPause}
      onEnded={onEnded}
      onError={() => {
        setFailed(true);
        onPause();
      }}
    />
  );
}
