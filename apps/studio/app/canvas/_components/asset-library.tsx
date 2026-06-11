"use client";

import { useEffect, useMemo, useState } from "react";
import { IconPhoto, IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { getImage, listProjectAssets, type ProjectAsset } from "@/lib/canvas-store";

type AssetTab = "generated" | "uploaded";

const TABS: { id: AssetTab; label: string }[] = [
  { id: "generated", label: "My Creations" },
  { id: "uploaded", label: "Uploaded" },
];

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

function AssetThumb({ asset, onPick }: { asset: ProjectAsset; onPick: (a: ProjectAsset) => void }) {
  const src = useAssetSrc(asset);
  return (
    <button
      type="button"
      title={asset.prompt ?? undefined}
      onClick={() => onPick(asset)}
      className="group relative aspect-square overflow-hidden rounded-lg bg-white/[0.04] transition-colors hover:bg-white/[0.08]"
    >
      {src ? (
        asset.kind === "video" ? (
          <video src={src} muted playsInline className="size-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={asset.prompt ?? "Asset"} className="size-full object-cover" />
        )
      ) : (
        <div className="flex size-full items-center justify-center">
          <IconPhoto className="size-5 text-white/25" stroke={1.5} />
        </div>
      )}
    </button>
  );
}

/**
 * The project's persistent asset library — a slide-in drawer (imagine.art-style)
 * over the canvas. "My Creations" = generated outputs; "Uploaded" = dropped/
 * uploaded media. Picking an asset hands it back to the canvas.
 */
export function AssetLibrary({
  projectId,
  open,
  onClose,
  onPick,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onPick: (asset: ProjectAsset) => void;
}) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [tab, setTab] = useState<AssetTab>("generated");
  const [query, setQuery] = useState("");

  // Load on open + poll while open so freshly generated assets show up live.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () =>
      void listProjectAssets(projectId).then((next) => !cancelled && setAssets(next));
    load();
    const timer = setInterval(load, 2500);
    return () => {
      cancelled = true;
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
        <div className="grid grid-cols-2 gap-2 overflow-y-auto p-4">
          {filtered.map((asset) => (
            <AssetThumb key={asset.id} asset={asset} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}
