"use client";

import { useState, type ReactNode, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { IconArrowLeft, IconArrowRight, IconPhoto, IconVideo } from "@tabler/icons-react";
import type { StoryCandidateAsset } from "@/lib/story-projects-api";
import type { StoryStoryboardClip } from "@/lib/story-production-api";

const CLIP_TYPE = "application/x-fizz-story-clip";
const MEDIA_TYPE = "application/x-fizz-story-media";

/** A small toolbar and drop surface; the existing timeline retains its layout. */
export function StoryTimelineArrange({
  children,
  clips,
  selectedClipId,
  candidates,
  disabled,
  loading,
  error,
  onRetry,
  onMove,
  onInsert,
}: {
  children: ReactNode;
  clips: readonly StoryStoryboardClip[];
  selectedClipId: string | null;
  candidates: StoryCandidateAsset[];
  disabled: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onMove: (clipId: string, beforeId: string | null) => void;
  onInsert: (candidate: StoryCandidateAsset, beforeId: string | null) => void;
}) {
  const t = useTranslations("storyStudio.editorPage.arrange");
  const [mediaOpen, setMediaOpen] = useState(false);
  const selected = clips.findIndex((clip) => clip.id === selectedClipId);
  const media = candidates.filter(({ asset }) => asset.kind === "image" || asset.kind === "video");
  const supported = (event: DragEvent) =>
    !disabled && [CLIP_TYPE, MEDIA_TYPE].some((type) => event.dataTransfer.types.includes(type));
  const targetId = (target: EventTarget | null) =>
    target instanceof Element
      ? (target.closest<HTMLElement>("[data-story-clip-id]")?.dataset.storyClipId ?? null)
      : null;
  return (
    <div
      className="shrink-0 min-w-0"
      onDragStart={(event) => {
        const id = targetId(event.target);
        if (!id) return;
        if (disabled) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData(CLIP_TYPE, id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        if (!supported(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(CLIP_TYPE)
          ? "move"
          : "copy";
      }}
      onDrop={(event) => {
        if (!supported(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const beforeId = targetId(event.target);
        const clipId = event.dataTransfer.getData(CLIP_TYPE);
        if (clipId) {
          if (clips.some((clip) => clip.id === clipId) && clipId !== beforeId)
            onMove(clipId, beforeId);
          return;
        }
        const assetId = event.dataTransfer.getData(MEDIA_TYPE);
        const candidate = media.find(({ asset }) => asset.id === assetId);
        if (candidate) onInsert(candidate, beforeId);
      }}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-white/65">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={mediaOpen}
          onClick={() => setMediaOpen(!mediaOpen)}
          className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-30"
        >
          {t("media")}
        </button>
        <button
          type="button"
          aria-label={t("earlier")}
          title={t("earlier")}
          disabled={disabled || selected <= 0}
          onClick={() => onMove(clips[selected]!.id, clips[selected - 1]!.id)}
          className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
        >
          <IconArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("later")}
          title={t("later")}
          disabled={disabled || selected < 0 || selected >= clips.length - 1}
          onClick={() => onMove(clips[selected]!.id, clips[selected + 2]?.id ?? null)}
          className="rounded p-1 hover:bg-white/10 disabled:opacity-30"
        >
          <IconArrowRight className="size-4" />
        </button>
        <span className="text-[10px] text-white/40">{t("hint")}</span>
      </div>
      {mediaOpen && (
        <div
          className="flex max-h-32 flex-wrap gap-2 overflow-y-auto px-3 pb-2"
          aria-label={t("media")}
        >
          {loading ? (
            <p role="status">{t("loading")}</p>
          ) : error ? (
            <p role="alert">
              {error}{" "}
              <button type="button" onClick={onRetry}>
                {t("retry")}
              </button>
            </p>
          ) : !media.length ? (
            <p className="text-xs text-white/50">{t("empty")}</p>
          ) : (
            media.map((candidate) => {
              const { asset } = candidate;
              const Icon = asset.kind === "video" ? IconVideo : IconPhoto;
              return (
                <button
                  key={asset.id}
                  type="button"
                  disabled={disabled}
                  draggable={!disabled}
                  title={t("insert", { title: asset.fileName || asset.id })}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(MEDIA_TYPE, asset.id);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onInsert(candidate, selectedClipId)}
                  className="inline-flex max-w-52 items-center gap-1 rounded bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30"
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{asset.fileName || asset.id}</span>
                </button>
              );
            })
          )}
        </div>
      )}
      {children}
    </div>
  );
}
