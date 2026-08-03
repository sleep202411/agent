"use client";

import type { MediaAssetReadinessResult } from "@repo/shared";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import { IconMusic } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { CanvasAsset } from "@/lib/canvas-core/types";
import { cn } from "@/lib/utils";
import { ASSET_DRAG_MIME } from "./asset-library-dnd";
import {
  MediaAssetReadinessChip,
  mediaAssetReadinessState,
  type MediaAssetReadinessState,
} from "./media-asset-readiness";
import { Icon720 } from "./panorama-viewer";

const SEEDANCE_REFERENCE_CAPABILITY = MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference;

export function AssetThumb({
  asset,
  readinessStatus,
  readinessFallback,
  floating = false,
}: {
  asset: CanvasAsset;
  readinessStatus?: MediaAssetReadinessResult;
  readinessFallback: MediaAssetReadinessState | null;
  floating?: boolean;
}) {
  const t = useTranslations("canvasNodes");
  const title = asset.name ?? asset.prompt ?? undefined;
  const state =
    asset.kind === "image" || asset.kind === "video"
      ? mediaAssetReadinessState(readinessStatus, readinessFallback)
      : null;
  return (
    <div
      title={title}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(asset));
        event.dataTransfer.effectAllowed = "copy";
      }}
      className={cn(
        "group cursor-grab overflow-hidden bg-white/[0.04] transition-colors hover:bg-white/[0.08] active:cursor-grabbing",
        floating ? "rounded-2xl" : "rounded-lg"
      )}
    >
      <div className="relative aspect-square overflow-hidden">
        {asset.kind === "video" ? (
          <video
            src={asset.url}
            muted
            playsInline
            draggable={false}
            className="pointer-events-none size-full object-cover"
          />
        ) : asset.kind === "audio" ? (
          <div className="pointer-events-none flex size-full items-center justify-center">
            <IconMusic className="size-7 text-white/70" stroke={1.7} />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.url}
            alt={title ?? t("asset.alt")}
            draggable={false}
            className="pointer-events-none size-full object-cover"
          />
        )}
        {asset.panorama && (
          <span className="pointer-events-none absolute top-1 left-1 flex items-center gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur-sm">
            <Icon720 className="size-2.5" /> 720°
          </span>
        )}
        <MediaAssetReadinessChip capability={SEEDANCE_REFERENCE_CAPABILITY} state={state} />
      </div>
      <div className="min-w-0 px-2 py-1.5">
        <p className="truncate text-[11px] leading-tight text-white/75">
          {title ?? t("asset.untitled")}
        </p>
      </div>
    </div>
  );
}
