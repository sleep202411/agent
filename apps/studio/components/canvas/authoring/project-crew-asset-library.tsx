"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { IconArrowLeft, IconFile, IconFolder, IconLoader2, IconPhoto } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { CanvasAsset } from "@/lib/canvas-core/types";
import {
  getProjectCrewAssetContext,
  listProjectCrewAssets,
  type ProjectCrewAssetNode,
} from "@/lib/collab/project-crew-assets-api";
import { cn } from "@/lib/utils";
import { AssetThumb } from "./asset-library-thumb";

interface FolderCrumb {
  id: string;
  name: string;
}

function canvasAsset(node: ProjectCrewAssetNode): CanvasAsset | null {
  const media = node.media;
  if (!media || !["image", "video", "audio"].includes(media.kind)) return null;
  return {
    id: `crew:${node.id}`,
    mediaAssetId: media.id,
    kind: media.kind as CanvasAsset["kind"],
    source: "uploaded",
    url: media.previewUrl,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    name: node.name,
    createdAt: 0,
    category: "general",
  };
}

function LibraryTile({
  node,
  floating,
  onOpenFolder,
}: {
  node: ProjectCrewAssetNode;
  floating: boolean;
  onOpenFolder: (node: ProjectCrewAssetNode) => void;
}) {
  const t = useTranslations("canvasNodes.asset.crew");
  if (node.kind === "folder") {
    return (
      <button
        type="button"
        onClick={() => onOpenFolder(node)}
        className={cn(
          "flex aspect-square flex-col items-center justify-center bg-white/[0.04] text-white/66 transition-colors hover:bg-white/[0.08] hover:text-white",
          floating ? "rounded-2xl" : "rounded-lg"
        )}
      >
        <IconFolder className="size-8" stroke={1.35} />
        <span className="mt-3 max-w-[85%] truncate text-[11px]">{node.name}</span>
      </button>
    );
  }

  const asset = canvasAsset(node);
  if (asset) {
    return <AssetThumb asset={asset} readinessFallback={null} floating={floating} />;
  }

  return (
    <div
      title={t("unsupported")}
      className={cn(
        "flex aspect-square flex-col items-center justify-center bg-white/[0.025] text-white/28",
        floating ? "rounded-2xl" : "rounded-lg"
      )}
    >
      <IconFile className="size-7" stroke={1.35} />
      <span className="mt-3 max-w-[85%] truncate text-[11px]">{node.name}</span>
    </div>
  );
}

export function ProjectCrewAssetLibrary({
  projectId,
  query,
  floating,
}: {
  projectId: string;
  query: string;
  floating: boolean;
}) {
  const t = useTranslations("canvasNodes.asset.crew");
  const deferredQuery = useDeferredValue(query.trim());
  const [path, setPath] = useState<FolderCrumb[]>([]);
  const parentId = path.at(-1)?.id;

  const context = useQuery({
    queryKey: ["project-crew-assets", projectId, "context"],
    queryFn: () => getProjectCrewAssetContext(projectId),
    staleTime: 30_000,
    retry: false,
  });
  const listing = useInfiniteQuery({
    queryKey: ["project-crew-assets", projectId, parentId ?? "root", deferredQuery],
    enabled: Boolean(context.data?.crew),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listProjectCrewAssets(projectId, {
        parentId,
        query: deferredQuery || undefined,
        cursor: pageParam,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = useMemo(
    () => listing.data?.pages.flatMap((page) => page.items) ?? [],
    [listing.data]
  );

  if (context.isPending || (Boolean(context.data?.crew) && listing.isPending)) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-white/35" stroke={1.5} />
      </div>
    );
  }
  if (context.isError || (Boolean(context.data?.crew) && listing.isError)) {
    const error = context.error ?? listing.error;
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <IconPhoto className="size-7 text-white/20" stroke={1.4} />
        <p className="mt-3 text-sm font-medium text-white/70">{t("errorTitle")}</p>
        <p className="mt-1.5 text-xs text-white/38">
          {error instanceof Error ? error.message : t("errorBody")}
        </p>
      </div>
    );
  }
  if (!context.data?.crew) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <IconPhoto className="size-7 text-white/20" stroke={1.4} />
        <p className="mt-3 text-sm font-medium text-white/70">{t("unlinkedTitle")}</p>
        <p className="mt-1.5 text-xs text-white/38">{t("unlinkedBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 px-4 text-[11px] text-white/48">
        {path.length > 0 ? (
          <button
            type="button"
            onClick={() => setPath((current) => current.slice(0, -1))}
            className="grid size-6 place-items-center rounded-lg transition-colors hover:bg-white/[0.07] hover:text-white"
            aria-label={t("back")}
          >
            <IconArrowLeft className="size-3.5" stroke={1.8} />
          </button>
        ) : null}
        <span className="truncate">
          {path.length > 0 ? path.map((crumb) => crumb.name).join(" / ") : context.data.crew.name}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <IconFolder className="size-7 text-white/20" stroke={1.4} />
          <p className="mt-3 text-sm font-medium text-white/70">{t("emptyTitle")}</p>
          <p className="mt-1.5 text-xs text-white/38">{t("emptyBody")}</p>
        </div>
      ) : (
        <div
          className={cn(
            "grid auto-rows-max grid-cols-3 gap-1.5 overflow-y-auto",
            floating ? "min-h-0 flex-1 px-4 pb-4" : "p-4 pt-1"
          )}
        >
          {items.map((node) => (
            <LibraryTile
              key={node.id}
              node={node}
              floating={floating}
              onOpenFolder={(folder) =>
                setPath((current) => [...current, { id: folder.id, name: folder.name }])
              }
            />
          ))}
          {listing.hasNextPage ? (
            <button
              type="button"
              disabled={listing.isFetchingNextPage}
              onClick={() => void listing.fetchNextPage()}
              className="col-span-3 h-8 rounded-xl text-[11px] text-white/42 transition-colors hover:bg-white/[0.05] hover:text-white/70"
            >
              {listing.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
