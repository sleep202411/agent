"use client";

import { useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconBookmark,
  IconLoader2,
  IconMusic,
  IconPhoto,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { CanvasDrawerPanel } from "@/components/canvas/canvas-drawer-panel";
import { cn } from "@/lib/utils";
import type { StoryCandidateAsset } from "@/lib/story-projects-api";
import type { StoryCandidateAssetsController } from "./use-story-candidate-assets";

type CandidateFilter = "all" | "image" | "video" | "audio";

export function StoryCandidateAssetsPanel({
  controller,
  onClose,
}: {
  controller: StoryCandidateAssetsController;
  onClose: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.productionCanvas.candidates");
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const items = useMemo(
    () =>
      filter === "all"
        ? controller.items
        : controller.items.filter((candidate) => candidate.asset.kind === filter),
    [controller.items, filter]
  );

  return (
    <CanvasDrawerPanel
      title={t("title")}
      description={t("description")}
      count={controller.items.length}
      icon={<IconBookmark className="size-4" stroke={1.8} />}
      closeLabel={t("close")}
      onClose={onClose}
    >
      <div className="flex gap-1 px-4 py-3" role="tablist" aria-label={t("filterLabel")}>
        {(["all", "image", "video", "audio"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "h-8 rounded-xl px-2.5 text-[10px] font-medium transition",
              filter === value
                ? "bg-white/[0.12] text-white"
                : "text-white/42 hover:bg-white/[0.07] hover:text-white/72"
            )}
          >
            {t(`filters.${value}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {controller.loading ? (
          <div className="grid h-40 place-items-center">
            <IconLoader2 className="size-5 animate-spin text-white/38" stroke={1.7} />
          </div>
        ) : controller.failed ? (
          <div className="mt-2 rounded-2xl bg-destructive/10 p-3 text-[10px] leading-4 text-destructive-foreground">
            <div className="flex items-start gap-2">
              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" stroke={1.8} />
              <span>{controller.error || t("loadError")}</span>
            </div>
            <button
              type="button"
              onClick={() => void controller.refresh()}
              className="mt-2 rounded-lg bg-white/[0.07] px-2 py-1 text-white/68 transition hover:bg-white/[0.12] hover:text-white"
            >
              {t("retry")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center px-5 text-center">
            <span className="grid size-11 place-items-center rounded-2xl bg-white/[0.055] text-white/28">
              <IconBookmark className="size-5" stroke={1.6} />
            </span>
            <p className="mt-3 text-xs font-medium text-white/58">
              {filter === "all" ? t("empty") : t("emptyFilter")}
            </p>
            <p className="mt-1.5 text-[10px] leading-4 text-white/30">{t("emptyDescription")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {items.map((candidate, index) => (
              <CandidateCard
                key={candidate.asset.id}
                candidate={candidate}
                index={index}
                pending={controller.pendingIds.has(candidate.asset.id)}
                onRemove={() => void controller.remove(candidate.asset.id)}
              />
            ))}
          </div>
        )}
      </div>
    </CanvasDrawerPanel>
  );
}

function CandidateCard({
  candidate,
  index,
  pending,
  onRemove,
}: {
  candidate: StoryCandidateAsset;
  index: number;
  pending: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.productionCanvas.candidates");
  const { asset } = candidate;
  const Icon = asset.kind === "video" ? IconVideo : asset.kind === "audio" ? IconMusic : IconPhoto;
  const label = t(`assetLabel.${asset.kind}`, { index: index + 1 });
  return (
    <article className="group relative overflow-hidden rounded-2xl bg-white/[0.045]">
      <div className="relative aspect-square bg-black/24">
        {asset.previewUrl && asset.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.previewUrl} alt={label} className="size-full object-cover" />
        ) : asset.previewUrl && asset.kind === "video" ? (
          <video
            src={asset.previewUrl}
            aria-label={label}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-white/25">
            <Icon className="size-6" stroke={1.5} />
          </div>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={onRemove}
          aria-label={t("remove")}
          className="absolute top-2 right-2 grid size-7 place-items-center rounded-xl bg-black/55 text-white/58 opacity-0 backdrop-blur-md transition group-hover:opacity-100 hover:bg-black/75 hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-60"
        >
          {pending ? (
            <IconLoader2 className="size-3.5 animate-spin" stroke={1.8} />
          ) : (
            <IconTrash className="size-3.5" stroke={1.8} />
          )}
        </button>
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-[10px] font-medium text-white/68">{label}</p>
        <p className="mt-0.5 truncate text-[9px] text-white/30">
          {asset.width && asset.height
            ? `${asset.width}×${asset.height}`
            : asset.contentType.split("/", 2)[1]?.toUpperCase() || asset.kind.toUpperCase()}
        </p>
      </div>
    </article>
  );
}
