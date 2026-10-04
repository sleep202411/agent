"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import {
  addStoryCandidateAsset,
  getStoryCandidateAssets,
  removeStoryCandidateAsset,
  storyApiErrorMessage,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";

export function storyCandidateAssetsQueryKey(projectId: string, userId: string | null) {
  return ["story-studio", "candidate-assets", projectId, userId] as const;
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
  const { user, isCurrentAccount } = useAuth();
  const userId = user ? String(user.id) : null;
  const queryKey = useMemo(
    () => storyCandidateAssetsQueryKey(projectId, userId),
    [projectId, userId]
  );
  const scope = useMemo(() => ({ projectId, userId, canEdit }), [projectId, userId, canEdit]);
  type Owner = { scope: typeof scope; operations: Map<string, AbortController> };
  const owner = useRef<Owner | null>(null);
  useLayoutEffect(() => {
    const current: Owner = { scope, operations: new Map() };
    owner.current = current;
    return () => {
      for (const operation of current.operations.values()) operation.abort();
      if (owner.current === current) owner.current = null;
    };
  }, [scope]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getStoryCandidateAssets(projectId, signal),
    staleTime: 20_000,
    enabled: enabled && Boolean(projectId && userId),
    retry: false,
  });
  const [pending, setPending] = useState<{ scope: typeof scope; ids: Set<string> } | null>(null);
  const pendingIds = pending?.scope === scope ? pending.ids : new Set<string>();
  const items = useMemo(() => query.data ?? [], [query.data]);
  const candidateIds = useMemo(
    () => new Set(items.map((candidate) => candidate.asset.id)),
    [items]
  );

  const withPending = useCallback(
    async (
      mediaAssetId: string,
      action: (signal: AbortSignal, current: () => boolean) => Promise<void>
    ) => {
      const owned = owner.current;
      if (
        owned?.scope !== scope ||
        !canEdit ||
        !projectId ||
        !userId ||
        !isCurrentAccount(userId) ||
        owned.operations.has(mediaAssetId)
      )
        return;
      const operation = new AbortController();
      owned.operations.set(mediaAssetId, operation);
      const current = () =>
        owner.current === owned && !operation.signal.aborted && isCurrentAccount(userId);
      setPending({ scope, ids: new Set(owned.operations.keys()) });
      try {
        await action(operation.signal, current);
      } catch (error) {
        if (current()) toast.error(storyApiErrorMessage(error, t("actionError")));
      } finally {
        owned.operations.delete(mediaAssetId);
        if (current()) setPending({ scope, ids: new Set(owned.operations.keys()) });
      }
    },
    [scope, canEdit, projectId, userId, isCurrentAccount, t]
  );

  const remove = useCallback(
    async (mediaAssetId: string) => {
      await withPending(mediaAssetId, async (signal, current) => {
        await removeStoryCandidateAsset(projectId, mediaAssetId, signal);
        if (!current()) return;
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
      await withPending(mediaAssetId, async (signal, current) => {
        const candidate = await addStoryCandidateAsset(projectId, mediaAssetId, signal);
        if (!current()) return;
        queryClient.setQueryData<StoryCandidateAsset[]>(queryKey, (current = []) => [
          candidate,
          ...current.filter((item) => item.asset.id !== mediaAssetId),
        ]);
      });
    },
    [candidateIds, projectId, queryClient, queryKey, remove, withPending]
  );

  const refresh = useCallback(async () => {
    if (owner.current?.scope !== scope || !projectId || !userId || !isCurrentAccount(userId))
      return;
    await query.refetch();
  }, [query, scope, projectId, userId, isCurrentAccount]);

  return {
    items,
    candidateIds,
    pendingIds,
    loading: query.isLoading,
    failed: query.isError,
    error: query.error ? storyApiErrorMessage(query.error, t("loadError")) : null,
    canEdit: canEdit && Boolean(userId && projectId),
    toggle,
    remove,
    refresh,
  };
}
