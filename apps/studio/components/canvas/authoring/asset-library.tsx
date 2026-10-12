"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import { IconCamera, IconLibraryPhoto, IconPhoto, IconSearch } from "@tabler/icons-react";
import { DrawerPanel } from "@/components/ui/drawer-panel";
import { cn } from "@/lib/utils";
import {
  projectAssetToCanvasAsset,
  useProjectAssets,
} from "@/lib/canvas-authoring/use-project-assets";
import {
  getMediaAssetReadinessStatuses,
  mediaAssetReadinessKeys,
} from "@/lib/media-asset-readiness";
import { AssetThumb } from "./asset-library-thumb";

export const ASSET_LIBRARY_WIDTH = 320;

type AssetTab = "generated" | "uploaded" | (string & {});

const BASE_TABS: { id: AssetTab; labelKey: "myCreations" | "uploaded" }[] = [
  { id: "generated", labelKey: "myCreations" },
  { id: "uploaded", labelKey: "uploaded" },
];

const SEEDANCE_REFERENCE_CAPABILITY = MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference;

function EmptyState({
  icon,
  title,
  body,
  floating = false,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  floating?: boolean;
}) {
  if (floating) {
    return (
      <div className="flex h-48 flex-col items-center justify-center px-5 text-center">
        <span className="grid size-11 place-items-center rounded-2xl bg-white/[0.055] text-white/28">
          {icon}
        </span>
        <p className="mt-3 text-xs font-medium text-white/58">{title}</p>
        <p className="mt-1.5 text-[10px] leading-4 text-white/30">{body}</p>
      </div>
    );
  }
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
 * Generated and uploaded tabs read the unified `useProjectAssets` inventory;
 * Image/video assets expose capability-specific readiness at the MediaAsset
 * layer; the UI only reflects that server state.
 */
export function AssetLibrary({
  open,
  onClose,
  variant = "default",
  description,
  customTab,
  onOpenDirectorDesk,
}: {
  open: boolean;
  onClose: () => void;
  variant?: "default" | "floating";
  description?: string;
  customTab?: {
    id: string;
    label: string;
    render: () => ReactNode;
  };
  onOpenDirectorDesk?: () => void;
}) {
  const t = useTranslations("canvasNodes");
  const { assets: projectAssets } = useProjectAssets("");
  const [tab, setTab] = useState<AssetTab>("generated");
  const [query, setQuery] = useState("");
  const tabs = useMemo(() => {
    return customTab ? [...BASE_TABS, { id: customTab.id, label: customTab.label }] : BASE_TABS;
  }, [customTab]);

  const canvasAssetCount = projectAssets.length;

  const filteredAssets = useMemo(() => {
    const origin = tab === "generated" ? "aiGenerated" : "uploaded";
    const q = query.trim().toLowerCase();
    return projectAssets
      .filter((asset) => asset.origin === origin)
      .filter(
        (asset) =>
          !q ||
          (asset.name ?? "").toLowerCase().includes(q) ||
          (asset.prompt ?? "").toLowerCase().includes(q)
      )
      .map(projectAssetToCanvasAsset);
  }, [projectAssets, tab, query]);

  const statusAssetIds = useMemo(
    () =>
      filteredAssets
        .filter((asset) => (asset.kind === "image" || asset.kind === "video") && asset.mediaAssetId)
        .map((asset) => asset.mediaAssetId as string),
    [filteredAssets]
  );
  const statusQuery = useQuery({
    queryKey: mediaAssetReadinessKeys.statuses(SEEDANCE_REFERENCE_CAPABILITY, statusAssetIds),
    queryFn: ({ signal }) =>
      getMediaAssetReadinessStatuses(
        SEEDANCE_REFERENCE_CAPABILITY,
        statusAssetIds,
        undefined,
        signal
      ),
    enabled: open && statusAssetIds.length > 0,
    refetchInterval: (queryState) => {
      const data = queryState.state.data;
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
  const floating = variant === "floating";
  const content =
    customTab && tab === customTab.id ? (
      customTab.render()
    ) : empty ? (
      <EmptyState
        icon={<IconPhoto className={floating ? "size-5" : "size-7 text-white/20"} stroke={1.4} />}
        title={t("asset.empty.title")}
        body={tab === "generated" ? t("asset.empty.generated") : t("asset.empty.uploaded")}
        floating={floating}
      />
    ) : (
      <div
        className={cn(
          "grid auto-rows-max grid-cols-3 gap-1.5 overflow-y-auto",
          floating ? "min-h-0 flex-1 px-4 pb-4" : "p-4"
        )}
      >
        {filteredAssets.map((asset) => (
          <AssetThumb
            key={asset.id}
            asset={asset}
            readinessStatus={
              asset.mediaAssetId ? statusQuery.data?.[asset.mediaAssetId] : undefined
            }
            readinessFallback={
              (asset.kind === "image" || asset.kind === "video") && asset.mediaAssetId
                ? statusQuery.isError
                  ? { kind: "unavailable" }
                  : statusQuery.isPending
                    ? null
                    : { kind: "not_requested" }
                : null
            }
            floating={floating}
          />
        ))}
      </div>
    );

  if (floating) {
    return (
      <>
        <DrawerPanel.Header
          title={t("asset.title")}
          description={description}
          count={canvasAssetCount}
          icon={<IconLibraryPhoto className="size-4" stroke={1.8} />}
          closeLabel={t("asset.close")}
          onClose={onClose}
        />
        <div className="flex shrink-0 gap-1 px-4 py-3" role="tablist" aria-label={t("asset.title")}>
          {tabs.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={tab === tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={cn(
                "h-8 rounded-xl px-2.5 text-[10px] font-medium transition",
                tab === tabItem.id
                  ? "bg-white/[0.12] text-white"
                  : "text-white/42 hover:bg-white/[0.07] hover:text-white/72"
              )}
            >
              {"label" in tabItem ? tabItem.label : t(`asset.tab.${tabItem.labelKey}`)}
            </button>
          ))}
        </div>

        <div className="mx-4 mb-3 flex h-9 shrink-0 items-center gap-2.5 rounded-xl bg-white/[0.055] px-3">
          <IconSearch className="size-3.5 shrink-0 text-white/34" stroke={1.8} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("asset.searchPlaceholder")}
            className="w-full bg-transparent text-[11px] text-white/78 outline-none placeholder:text-white/30"
          />
        </div>
        {onOpenDirectorDesk ? (
          <button
            type="button"
            onClick={onOpenDirectorDesk}
            className="mx-4 mb-3 flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white/[0.07] text-[10px] font-medium text-white/72 transition hover:bg-white/[0.12] hover:text-white"
          >
            <IconCamera className="size-3.5" stroke={1.8} />
            {t("asset.directorDesk.open")}
          </button>
        ) : null}

        <DrawerPanel.Body>{content}</DrawerPanel.Body>
      </>
    );
  }

  return (
    <>
      <DrawerPanel.Header
        title={t("asset.title")}
        icon={<IconLibraryPhoto className="size-4" stroke={1.8} />}
        closeLabel={t("asset.close")}
        onClose={onClose}
      />

      <div className="grid shrink-0 grid-cols-3 gap-1 px-4 py-2">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            className={cn(
              "min-w-0 truncate rounded-xl px-1.5 py-1.5 text-[10px] font-medium transition-colors",
              tab === tabItem.id
                ? "bg-white/[0.1] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {"label" in tabItem ? tabItem.label : t(`asset.tab.${tabItem.labelKey}`)}
          </button>
        ))}
      </div>

      <div className="mx-4 mb-3 flex h-9 shrink-0 items-center gap-2.5 rounded-full bg-white/[0.055] px-3.5">
        <IconSearch className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("asset.searchPlaceholder")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {onOpenDirectorDesk ? (
        <button
          type="button"
          onClick={onOpenDirectorDesk}
          className="mx-4 mb-3 flex h-9 shrink-0 items-center justify-center gap-2 rounded-full bg-white/[0.07] text-xs font-medium text-white/72 transition hover:bg-white/[0.12] hover:text-white"
        >
          <IconCamera className="size-4" stroke={1.8} />
          {t("asset.directorDesk.open")}
        </button>
      ) : null}

      <DrawerPanel.Body>{content}</DrawerPanel.Body>
    </>
  );
}
