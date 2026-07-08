"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconPhoto, IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useCanvasGraphContext } from "@/lib/collab/canvas-graph-context";
import type { CanvasAsset } from "@/lib/collab/canvas-doc";
import {
  getMediaProviderAssetStatuses,
  mediaProviderAssetKeys,
  type MediaProviderAssetStatus,
} from "@/lib/media-provider-assets";
import { Icon720 } from "./panorama-viewer";
import {
  MediaProviderStatusChip,
  mediaProviderStatusState,
  type MediaProviderStatusState,
} from "./media-provider-status-chip";

/** dataTransfer type carrying a dragged library asset to the canvas. */
export const ASSET_DRAG_MIME = "application/x-fizz-asset";
export const ASSET_LIBRARY_WIDTH = 320;

type AssetTab = "generated" | "uploaded";

const TABS: { id: AssetTab; labelKey: "myCreations" | "uploaded" }[] = [
  { id: "generated", labelKey: "myCreations" },
  { id: "uploaded", labelKey: "uploaded" },
];

function AssetThumb({
  asset,
  providerStatus,
  providerFallback,
}: {
  asset: CanvasAsset;
  providerStatus?: MediaProviderAssetStatus;
  providerFallback: MediaProviderStatusState | null;
}) {
  const t = useTranslations("canvasNodes");
  const state =
    asset.kind === "image" ? mediaProviderStatusState(providerStatus, providerFallback) : null;
  return (
    <div
      title={asset.prompt ?? undefined}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(asset));
        event.dataTransfer.effectAllowed = "copy";
      }}
      className="group relative aspect-square cursor-grab overflow-hidden rounded-lg bg-white/[0.04] transition-colors hover:bg-white/[0.08] active:cursor-grabbing"
    >
      {asset.kind === "video" ? (
        <video
          src={asset.url}
          muted
          playsInline
          draggable={false}
          className="pointer-events-none size-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.url}
          alt={asset.prompt ?? t("asset.alt")}
          draggable={false}
          className="pointer-events-none size-full object-cover"
        />
      )}
      {asset.panorama && (
        <span className="pointer-events-none absolute top-1 left-1 flex items-center gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur-sm">
          <Icon720 className="size-2.5" /> 720°
        </span>
      )}
      <MediaProviderStatusChip state={state} />
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      {icon}
      <p className="text-sm font-medium text-white/70">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * The project's persistent asset library — a slide-in drawer over the canvas.
 * Generated and uploaded image assets are provider-checked at the MediaAsset
 * layer; the UI only reflects that server state.
 */
export function AssetLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("canvasNodes");
  const { assets } = useCanvasGraphContext();
  const [tab, setTab] = useState<AssetTab>("generated");
  const [query, setQuery] = useState("");

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter(
      (a) => a.source === tab && (!q || (a.prompt ?? "").toLowerCase().includes(q))
    );
  }, [assets, tab, query]);

  const statusAssetIds = useMemo(
    () =>
      filteredAssets
        .filter((asset) => asset.kind === "image" && asset.mediaAssetId)
        .map((asset) => asset.mediaAssetId as string),
    [filteredAssets]
  );
  const statusQuery = useQuery({
    queryKey: mediaProviderAssetKeys.statuses(statusAssetIds),
    queryFn: () => getMediaProviderAssetStatuses(statusAssetIds),
    enabled: open && statusAssetIds.length > 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return Object.values(data).some(
        (status) => status.status === "pending" || status.status === "processing"
      )
        ? 8_000
        : false;
    },
  });

  if (!open) return null;
  const empty = filteredAssets.length === 0;

  return (
    <div
      className="absolute top-0 left-0 z-30 flex h-full flex-col bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
      style={{ width: ASSET_LIBRARY_WIDTH }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="text-base font-semibold">{t("asset.title")}</span>
        <button
          type="button"
          aria-label={t("asset.close")}
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-4">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
              tab === tabItem.id
                ? "bg-white/[0.1] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`asset.tab.${tabItem.labelKey}`)}
          </button>
        ))}
      </div>

      <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-full bg-white/[0.05] px-3.5 py-2">
        <IconSearch className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("asset.searchPlaceholder")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {empty ? (
        <EmptyState
          icon={<IconPhoto className="size-7 text-white/20" stroke={1.4} />}
          title={t("asset.empty.title")}
          body={tab === "generated" ? t("asset.empty.generated") : t("asset.empty.uploaded")}
        />
      ) : (
        <div className="grid auto-rows-max grid-cols-2 gap-2 overflow-y-auto p-4">
          {filteredAssets.map((asset) => (
            <AssetThumb
              key={asset.id}
              asset={asset}
              providerStatus={
                asset.mediaAssetId ? statusQuery.data?.[asset.mediaAssetId] : undefined
              }
              providerFallback={
                asset.kind === "image" && asset.mediaAssetId
                  ? statusQuery.isError
                    ? { kind: "unavailable" }
                    : { kind: "pending" }
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
