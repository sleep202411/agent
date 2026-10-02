"use client";

import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/app/_components/auth-provider";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import type { AssetCategory, CanvasAsset } from "@/lib/canvas-core/types";
import {
  getProjectCrewAssetContext,
  listAllProjectCrewAssets,
} from "@/lib/collab/project-crew-assets-api";
import { mentionLabel, type MentionItem } from "@/lib/prompt-mentions";

export type AssetOrigin = "aiGenerated" | "uploaded" | "crew";

/** Filter chips in AssetSelectDialog / shared inventory views. */
export type AssetFilter = "all" | AssetOrigin | "character" | "scene";

/**
 * Unified project asset row — canvas graph inventory + flat crew files.
 * Two orthogonal dimensions: `origin` (where it came from) and `category`
 * (semantic role). Filters map onto one or the other, never both.
 */
export interface ProjectAsset {
  id: string;
  mediaAssetId?: string;
  kind: "image" | "video" | "audio";
  url: string;
  name?: string;
  prompt?: string;
  panorama?: boolean;
  width?: number;
  height?: number;
  durationSeconds?: number;
  bytes?: number;
  createdAt: number;
  /** Source dimension: AI-generated / uploaded / crew library. */
  origin: AssetOrigin;
  /** Semantic dimension: general / character / scene. */
  category: AssetCategory;
}

function matchesFilter(asset: ProjectAsset, filter: AssetFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "aiGenerated":
      return asset.origin === "aiGenerated";
    case "uploaded":
      return asset.origin === "uploaded";
    case "crew":
      return asset.origin === "crew";
    case "character":
      return asset.category === "character";
    case "scene":
      return asset.category === "scene";
  }
}

/**
 * Single inventory for the asset picker + library generated/uploaded tabs.
 *
 * - Canvas graph assets → `origin` from `source`, `category` defaulting to general
 * - Crew files (all folders) → `origin: "crew"`, category general
 *
 * Folder navigation stays in `ProjectCrewAssetLibrary`; the dialog only needs
 * a flat list. Crew query keys match the library so react-query shares cache.
 */
export function useProjectAssets(projectId: string): {
  assets: ProjectAsset[];
  filtered: ProjectAsset[];
  filter: AssetFilter;
  setFilter: (f: AssetFilter) => void;
  isLoading: boolean;
  error: Error | null;
  isRetrying: boolean;
  retry: () => Promise<unknown>;
} {
  const { assets: canvasAssets } = useCanvasGraphContext();
  const [filter, setFilter] = useState<AssetFilter>("all");

  const { user } = useAuth();
  const context = useQuery({
    queryKey: ["project-crew-assets", projectId, "context", user?.id],
    queryFn: ({ signal }) => getProjectCrewAssetContext(projectId, signal),
    enabled: Boolean(projectId && user?.id),
    staleTime: 30_000,
    retry: false,
  });

  // Load every folder and page so canvas saves are available in production pickers.
  // Distinct key from ProjectCrewAssetLibrary's infinite query so cache shapes
  // never collide (infinite pages vs a single page).
  const crewList = useQuery({
    queryKey: ["project-crew-assets", projectId, "all-folders", user?.id, context.data?.crew?.id],
    queryFn: async ({ signal }) => ({ items: await listAllProjectCrewAssets(projectId, signal) }),
    enabled: Boolean(projectId && user?.id && context.data?.crew && !context.isError),
    staleTime: 30_000,
    retry: false,
  });

  const crewAccessLost =
    crewList.error instanceof ApiRequestError &&
    [401, 403, 404, 410].includes(crewList.error.status);
  const canUseCrewAssets =
    !!user?.id && !!context.data?.crew && !context.isError && !crewAccessLost;
  const assets = useMemo(() => {
    const fromCanvas: ProjectAsset[] = canvasAssets
      .map((asset) => ({
        id: asset.id,
        mediaAssetId: asset.mediaAssetId,
        kind: asset.kind,
        url: asset.url,
        name: asset.name,
        prompt: asset.prompt,
        panorama: asset.panorama,
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.durationSeconds,
        bytes: asset.bytes,
        createdAt: asset.createdAt,
        origin: (asset.source === "generated" ? "aiGenerated" : "uploaded") as AssetOrigin,
        category: (asset.category ?? "general") as AssetCategory,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    const fromCrew: ProjectAsset[] = [];
    for (const node of canUseCrewAssets ? (crewList.data?.items ?? []) : []) {
      if (node.kind !== "file" || !node.media) continue;
      const media = node.media;
      if (media.kind !== "image" && media.kind !== "video" && media.kind !== "audio") continue;
      fromCrew.push({
        id: `crew:${node.id}`,
        mediaAssetId: media.id,
        kind: media.kind,
        url: media.previewUrl,
        name: node.name,
        width: media.width ?? undefined,
        height: media.height ?? undefined,
        durationSeconds: media.durationSeconds ?? undefined,
        bytes: media.sizeBytes ?? undefined,
        createdAt: 0,
        origin: "crew",
        category: "general",
      });
    }

    return [...fromCanvas, ...fromCrew];
  }, [canvasAssets, crewList.data, canUseCrewAssets]);

  const filtered = useMemo(
    () => assets.filter((asset) => matchesFilter(asset, filter)),
    [assets, filter]
  );

  const isLoading =
    Boolean(projectId && user?.id) &&
    (context.isPending || (Boolean(context.data?.crew) && crewList.isPending));

  return {
    assets,
    filtered,
    filter,
    setFilter,
    isLoading,
    error: context.error ?? crewList.error,
    isRetrying: context.isFetching || crewList.isFetching,
    retry: () => (context.isError ? context.refetch() : crewList.refetch()),
  };
}

/** Map a ProjectAsset back to CanvasAsset for thumbs / drag that expect the graph shape. */
export function projectAssetToCanvasAsset(asset: ProjectAsset): CanvasAsset {
  return {
    id: asset.id,
    mediaAssetId: asset.mediaAssetId,
    kind: asset.kind,
    source: asset.origin === "aiGenerated" ? "generated" : "uploaded",
    url: asset.url,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    bytes: asset.bytes,
    name: asset.name,
    prompt: asset.prompt,
    panorama: asset.panorama,
    createdAt: asset.createdAt,
    category: asset.category,
  };
}

/**
 * Convert a project asset into a `@`-mention token. Label index is the 1-based
 * position among same-kind assets in `allAssets` (stable inventory order).
 */
export function projectAssetToMentionItem(
  asset: ProjectAsset,
  allAssets: readonly ProjectAsset[]
): MentionItem {
  let index = 0;
  for (const candidate of allAssets) {
    if (candidate.kind !== asset.kind) continue;
    index += 1;
    if (candidate.id === asset.id) break;
  }
  return {
    id: asset.id,
    label: mentionLabel(asset.kind, index || 1),
    name: asset.name,
    kind: asset.kind,
    previewUrl: asset.url,
    assetId: asset.mediaAssetId,
    durationSeconds: asset.durationSeconds,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
  };
}
