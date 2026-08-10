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

export function storyCandidateAssetsQueryKey(workspaceId: string | null, projectId: string) {
  return ["story-studio", "candidate-assets", workspaceId ?? "no-workspace", projectId] as const;
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
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string | null;
  projectId: string;
  canEdit: boolean;
}): StoryCandidateAssetsController {
  const t = useTranslations("storyStudio.canvas.creativeWorkbench.candidates");
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => storyCandidateAssetsQueryKey(workspaceId, projectId),
    [projectId, workspaceId]
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getStoryCandidateAssets(workspaceId as string, projectId, signal),
    enabled: Boolean(workspaceId),
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
      if (!workspaceId || !canEdit || pendingIdsRef.current.has(mediaAssetId)) return;
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
    [canEdit, t, workspaceId]
  );

  const remove = useCallback(
    async (mediaAssetId: string) => {
      await withPending(mediaAssetId, async () => {
        await removeStoryCandidateAsset(workspaceId as string, projectId, mediaAssetId);
        queryClient.setQueryData<StoryCandidateAsset[]>(queryKey, (current = []) =>
          current.filter((candidate) => candidate.asset.id !== mediaAssetId)
        );
      });
    },
    [projectId, queryClient, queryKey, withPending, workspaceId]
  );

  const toggle = useCallback(
    async (mediaAssetId: string) => {
      if (candidateIds.has(mediaAssetId)) {
        await remove(mediaAssetId);
        return;
      }
      await withPending(mediaAssetId, async () => {
        const candidate = await addStoryCandidateAsset(
          workspaceId as string,
          projectId,
          mediaAssetId
        );
        queryClient.setQueryData<StoryCandidateAsset[]>(queryKey, (current = []) => [
          candidate,
          ...current.filter((item) => item.asset.id !== mediaAssetId),
        ]);
      });
    },
    [candidateIds, projectId, queryClient, queryKey, remove, withPending, workspaceId]
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
