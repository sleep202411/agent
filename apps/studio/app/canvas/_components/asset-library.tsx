"use client";

import { useEffect, useMemo, useState } from "react";
import { IconPhoto, IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  getImage,
  listProjectAssets,
  onProjectAssetsChanged,
  type ProjectAsset,
} from "@/lib/canvas-store";
import { Icon720 } from "./panorama-viewer";

/** dataTransfer type carrying a dragged library asset to the canvas. */
export const ASSET_DRAG_MIME = "application/x-fizz-asset";

type AssetTab = "generated" | "uploaded";

const TABS: { id: AssetTab; label: string }[] = [
  { id: "generated", label: "My Creations" },
  { id: "uploaded", label: "Uploaded" },
];
const ASSET_RECONCILE_INTERVAL_MS = 30_000;

/** Resolves an uploaded asset's blob to an object URL; generated assets use their url. */
function useAssetSrc(asset: ProjectAsset): string | undefined {
  const [blobUrl, setBlobUrl] = useState<string>();
  useEffect(() => {
    if (asset.url || !asset.imageId) return;
    let revoked = false;
    let created: string | undefined;
    void getImage(asset.imageId).then((blob) => {
      if (blob && !revoked) {
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      }
    });
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [asset.url, asset.imageId]);
  return asset.url ?? blobUrl;
}

function AssetThumb({ asset }: { asset: ProjectAsset }) {
  const src = useAssetSrc(asset);
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
      {src ? (
        asset.kind === "video" ? (
          <video
            src={src}
            muted
            playsInline
            draggable={false}
            className="pointer-events-none size-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={asset.prompt ?? "Asset"}
            draggable={false}
            className="pointer-events-none size-full object-cover"
          />
        )
      ) : (
        <div className="flex size-full items-center justify-center">
          <IconPhoto className="size-5 text-white/25" stroke={1.5} />
        </div>
      )}
      {asset.panorama && (
        <span className="pointer-events-none absolute top-1 left-1 flex items-center gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur-sm">
          <Icon720 className="size-2.5" /> 720°
        </span>
      )}
    </div>
  );
}

/**
 * The project's persistent asset library — a slide-in drawer (imagine.art-style)
 * over the canvas. "My Creations" = generated outputs; "Uploaded" = dropped/
 * uploaded media. Drag an asset out onto the canvas to place it.
 */
export function AssetLibrary({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [tab, setTab] = useState<AssetTab>("generated");
  const [query, setQuery] = useState("");

  // Load on open, update from project-asset events, then reconcile occasionally.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () =>
      void listProjectAssets(projectId).then((next) => !cancelled && setAssets(next));
    load();
    const unsubscribe = onProjectAssetsChanged((event) => {
      if (event.projectId === projectId) load();
    });
    const timer = setInterval(load, ASSET_RECONCILE_INTERVAL_MS);
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(timer);
    };
  }, [open, projectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter(
      (a) => a.source === tab && (!q || (a.prompt ?? "").toLowerCase().includes(q))
    );
  }, [assets, tab, query]);

  if (!open) return null;

  return (
    <div className="absolute top-0 left-0 z-30 flex h-full w-[320px] flex-col bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="text-base font-semibold">Assets</span>
        <button
          type="button"
          aria-label="Close assets"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-white/[0.1] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-full bg-white/[0.05] px-3.5 py-2">
        <IconSearch className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search assets"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <IconPhoto className="size-7 text-white/20" stroke={1.4} />
          <p className="text-sm font-medium text-white/70">No assets yet</p>
          <p className="text-xs text-muted-foreground">
            {tab === "generated"
              ? "Generations in this project show up here."
              : "Media you upload to this project shows up here."}
          </p>
        </div>
      ) : (
        <div className="grid auto-rows-max grid-cols-2 gap-2 overflow-y-auto p-4">
          {filtered.map((asset) => (
            <AssetThumb key={asset.id} asset={asset} />
          ))}
        </div>
      )}
    </div>
  );
}
