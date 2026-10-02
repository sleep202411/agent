"use client";

import { useAuth } from "@/app/_components/auth-provider";

import { useDeferredValue, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconFile,
  IconFolder,
  IconLoader2,
  IconPhoto,
  IconSearch,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DrawerPanel } from "@/components/ui/drawer-panel";
import type { CanvasAsset } from "@/lib/canvas-core/types";
import {
  getProjectCrewAssetContext,
  listProjectCrewAssets,
  type ProjectCrewAssetNode,
  type ProjectCrewAssetContext,
} from "@/lib/collab/project-crew-assets-api";
import { cn } from "@/lib/utils";
import { ApiRequestError } from "@/lib/api";
import { AssetThumb } from "./asset-library-thumb";

interface FolderCrumb {
  id: string;
  name: string;
}

export function ProjectCrewAssetsPanel({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const t = useTranslations("canvasNodes");
  const [query, setQuery] = useState("");

  return (
    <>
      <DrawerPanel.Header
        title={t("asset.tab.crew")}
        icon={<IconFolder className="size-4" stroke={1.8} />}
        closeLabel={t("asset.close")}
        onClose={onClose}
      />
      <div className="mx-4 my-3 flex h-9 shrink-0 items-center gap-2.5 rounded-full bg-white/[0.055] px-3.5">
        <IconSearch className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("asset.searchPlaceholder")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <DrawerPanel.Body>
        <ProjectCrewAssetLibrary projectId={projectId} query={query} floating={false} />
      </DrawerPanel.Body>
    </>
  );
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
  const { user } = useAuth();
  const userId = user?.id;
  const context = useQuery({
    queryKey: ["project-crew-assets", projectId, "context", userId],
    queryFn: ({ signal }) => getProjectCrewAssetContext(projectId, signal),
    enabled: Boolean(projectId && userId),
    staleTime: 30_000,
    retry: false,
  });
  return (
    <CrewLibraryContents
      key={`${projectId}:${userId}:${context.data?.crew?.id}`}
      projectId={projectId}
      query={query}
      floating={floating}
      userId={userId}
      context={context}
    />
  );
}
function CrewLibraryContents({
  projectId,
  query,
  floating,
  userId,
  context,
}: {
  projectId: string;
  query: string;
  floating: boolean;
  userId: string | number | undefined;
  context: UseQueryResult<ProjectCrewAssetContext, Error>;
}) {
  const t = useTranslations("canvasNodes.asset.crew");
  const common = useTranslations("common");
  const deferredQuery = useDeferredValue(query.trim());
  const [path, setPath] = useState<FolderCrumb[]>([]);
  const parentId = path.at(-1)?.id;
  const listing = useInfiniteQuery({
    queryKey: [
      "project-crew-assets",
      projectId,
      parentId ?? "root",
      deferredQuery,
      userId,
      context.data?.crew?.id,
    ],
    enabled: Boolean(context.data?.crew && userId && !context.isError),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listProjectCrewAssets(
        projectId,
        {
          parentId,
          query: deferredQuery || undefined,
          cursor: pageParam,
        },
        signal
      ),
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
  const accessUnavailable =
    listing.error instanceof ApiRequestError && [401, 403, 404, 410].includes(listing.error.status);
  if (
    context.isError ||
    (Boolean(context.data?.crew) && listing.isError && (items.length === 0 || accessUnavailable))
  ) {
    const error = context.error ?? listing.error;
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <IconPhoto className="size-7 text-white/20" stroke={1.4} />
        <p className="mt-3 text-sm font-medium text-white/70">{t("errorTitle")}</p>
        <p role="alert" className="mt-1.5 break-words text-xs text-muted-foreground">
          {error instanceof Error ? error.message : t("errorBody")}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {path.length > 0 && !context.isError && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPath((current) => current.slice(0, -1))}
            >
              {t("back")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={context.isFetching || listing.isFetching}
            onClick={() => void (context.isError ? context.refetch() : listing.refetch())}
          >
            {common("retry")}
          </Button>
        </div>
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

      {listing.isError && (
        <div
          role="alert"
          className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground"
        >
          <p className="min-w-0 flex-1 break-words">{listing.error.message || t("errorBody")}</p>
          <Button
            size="sm"
            variant="secondary"
            disabled={listing.isFetching}
            onClick={() =>
              void (listing.isFetchNextPageError
                ? listing.fetchNextPage({ cancelRefetch: false })
                : listing.refetch())
            }
          >
            {common("retry")}
          </Button>
        </div>
      )}
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
              onClick={() => void listing.fetchNextPage({ cancelRefetch: false })}
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
