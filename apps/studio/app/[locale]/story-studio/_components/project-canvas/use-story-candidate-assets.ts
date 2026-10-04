"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addStoryCandidateAsset,
  getStoryCandidateAssets,
  removeStoryCandidateAsset,
  storyApiErrorMessage,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";

export function storyCandidateAssetsQueryKey(projectId: string) {
  return ["story-studio", "candidate-assets", projectId] as const;
}

export interface StoryCandidateAssetsController {
  items: StoryCandidateAsset[];
  candidateIds: ReadonlySet<string>;
  pendingIds: ReadonlySet<string>;
  loading: boolean;
  failed: boolean;
  error: string | null;
  canEdit: boolean;
  toggle: (mediaAssetId: string) => Promise<void>;
  remove: (mediaAssetId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useStoryCandidateAssets({
  projectId,
  canEdit,
  enabled = true,
}: {
  projectId: string;
  canEdit: boolean;
  enabled?: boolean;
}): StoryCandidateAssetsController {
  const t = useTranslations("storyStudio.canvas.creativeWorkbench.candidates");
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => storyCandidateAssetsQueryKey(projectId), [projectId]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getStoryCandidateAssets(projectId, signal),
    enabled,
    staleTime: 20_000,
  });
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const pendingIdsRef = useRef(new Set<string>());
  const items = useMemo(() => query.data ?? [], [query.data]);
  const candidateIds = useMemo(
    () => new Set(items.map((candidate) => candidate.asset.id)),
    [items]
  );

  const withPending = useCallback(
    async (mediaAssetId: string, action: () => Promise<void>) => {
      if (!canEdit || pendingIdsRef.current.has(mediaAssetId)) return;
      pendingIdsRef.current.add(mediaAssetId);
      setPendingIds((current) => new Set(current).add(mediaAssetId));
      try {
        await action();
      } catch (error) {
        const message = storyApiErrorMessage(error, t("actionError"));
        toast.error(message);
      } finally {
        pendingIdsRef.current.delete(mediaAssetId);
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(mediaAssetId);
          return next;
        });
      }
    },
    [canEdit, t]
  );

  const remove = useCallback(
    async (mediaAssetId: string) => {
      await withPending(mediaAssetId, async () => {
        await removeStoryCandidateAsset(projectId, mediaAssetId);
        queryClient.setQueryData<StoryCandidateAsset[]>(queryKey, (current = []) =>
          current.filter((candidate) => candidate.asset.id !== mediaAssetId)
        );
      });
    },
    [projectId, queryClient, queryKey, withPending]
  );

  const toggle = useCallback(
    async (mediaAssetId: string) => {
      if (candidateIds.has(mediaAssetId)) {
        await remove(mediaAssetId);
        return;
      }
      await withPending(mediaAssetId, async () => {
        const candidate = await addStoryCandidateAsset(projectId, mediaAssetId);
        queryClient.setQueryData<StoryCandidateAsset[]>(queryKey, (current = []) => [
          candidate,
          ...current.filter((item) => item.asset.id !== mediaAssetId),
        ]);
      });
    },
    [candidateIds, projectId, queryClient, queryKey, remove, withPending]
  );

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    items,
    candidateIds,
    pendingIds,
    loading: query.isLoading,
    failed: query.isError,
    error: query.error ? storyApiErrorMessage(query.error, t("loadError")) : null,
    canEdit,
    toggle,
    remove,
    refresh,
  };
}
