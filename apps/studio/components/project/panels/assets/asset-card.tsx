"use client";

import { IconCheck, IconLoader2, IconMusic } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { IconVideo } from "@tabler/icons-react";
import { buildOssImageUrl, buildOssVideoThumbnail } from "@/src/lib/uploads/workspace-upload";
import {
  type AssetListItem,
  getAssetUrl,
  isAudioType,
  isImageType,
  isVideoType,
} from "./asset-utils";

interface AssetCardProps {
  asset: AssetListItem;
  selected?: boolean;
  deleting?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
  onClick?: () => void;
}

export function AssetCard({
  asset,
  selected,
  deleting,
  selectable = true,
  onSelect,
  onClick,
}: AssetCardProps) {
  const t = useTranslations("asset");
  const url = getAssetUrl(asset);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !asset.uploading && onClick?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!asset.uploading) onClick?.();
        }
      }}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card transition-all",
        selected
          ? "border-primary shadow-[0_0_0_1px_rgba(229,34,39,0.35)]"
          : "border-border/70 hover:border-primary/40",
        isAudioType(asset.type) ? "aspect-[1.2/1]" : "aspect-square"
      )}
    >
      {isImageType(asset.type) ? (
        <img
          src={buildOssImageUrl(asset.path ?? asset.filePath ?? asset.storagePath ?? asset.url, {
            width: 400,
            height: 400,
            mode: "fill",
          })}
          alt={String(asset.name ?? "")}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : isVideoType(asset.type) ? (
        <div className="relative h-full w-full">
          <img
            src={
              url.startsWith("blob:")
                ? url
                : buildOssVideoThumbnail(
                    asset.path ?? asset.filePath ?? asset.storagePath ?? asset.url,
                    { w: 400 }
                  )
            }
            alt={String(asset.name ?? "")}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          <div className="absolute bottom-2 left-2">
            <IconVideo className="size-3.5 text-white drop-shadow-md" />
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col justify-between bg-gradient-to-br from-muted to-background p-3">
          <div className="flex items-center justify-between">
            <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <IconMusic className="size-4" />
            </div>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              audio
            </span>
          </div>
          <div>
            <div className="truncate text-xs font-medium">{asset.name || t("audioAsset")}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {asset.createTime
                ? new Date(asset.createTime).toLocaleTimeString()
                : t("justUploaded")}
            </div>
          </div>
        </div>
      )}

      {/* Checkbox */}
      {selectable && (
        <button
          type="button"
          className="absolute left-2 top-2"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
        >
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border border-white/30 bg-black/40 text-white transition-colors",
              selected && "border-primary bg-primary"
            )}
          >
            {selected ? <IconCheck className="size-3" /> : null}
          </span>
        </button>
      )}

      {/* File type badge */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent px-2.5 pb-2 pt-8 text-white">
        <div className="text-[10px] font-medium uppercase tracking-wide text-white/80">
          {asset.uploading ? t("uploading") : (asset.type || "asset").toUpperCase()}
        </div>
      </div>

      {/* Deleting overlay */}
      {deleting && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Uploading overlay */}
      {asset.uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <div className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1.5 text-xs shadow-lg">
            <IconLoader2 className="size-3.5 animate-spin" />
            {t("uploading")}
          </div>
        </div>
      )}
    </div>
  );
}
