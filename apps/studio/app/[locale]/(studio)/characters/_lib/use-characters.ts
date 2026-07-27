"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/app/_components/auth-provider";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import { getAssetsRealtimeKernel } from "@/lib/canvas-authoring/assets-realtime-kernel";
import { getCharacter, listCharacters, type CharacterDetail } from "@/lib/characters-api";

/**
 * React-query surface for the character library (matches the use-ai-catalog
 * keying convention). The list is workspace-scoped (the library is the
 * workspace 演员池); details are id-scoped and shared across surfaces.
 */
export const charactersKeys = {
  all: ["fizzstudio", "characters"] as const,
  lists: () => [...charactersKeys.all, "list"] as const,
  list: (workspaceId: string | null) => [...charactersKeys.lists(), workspaceId ?? "none"] as const,
  detail: (id: string) => [...charactersKeys.all, "detail", id] as const,
};

/** Workspace library list — disabled until the active workspace is known. */
export function useCharacters(workspaceId: string | null) {
  return useQuery({
    queryKey: charactersKeys.list(workspaceId),
    queryFn: () => listCharacters(workspaceId as string),
    enabled: workspaceId !== null,
    staleTime: 30_000,
  });
}

/** One character with its ordered media. No retry: a 404 (deleted / foreign
 *  workspace) must surface as the not-found state, not three spinners. */
export function useCharacter(id: string) {
  return useQuery({
    queryKey: charactersKeys.detail(id),
    queryFn: () => getCharacter(id),
    staleTime: 15_000,
    retry: false,
  });
}

/**
 * Write a fresh server-returned CharacterDetail into the detail cache and
 * refresh the library lists (covers/media counts/name shown on cards). Every
 * mutation endpoint returns the full detail, so this is the single
 * cache-sync path.
 */
export function useApplyCharacterDetail(): (detail: CharacterDetail) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (detail: CharacterDetail) => {
      queryClient.setQueryData(charactersKeys.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: charactersKeys.lists() });
    },
    [queryClient]
  );
}

/**
 * Leave-and-notify realtime for the character surfaces: subscribe to the
 * shared assets socket (kernel — one socket per workspace scope, refcounted)
 * and reconcile the react-query caches whenever a `character_media_updated`
 * event lands (provider-mirror flips, enrollment status changes). Mount once
 * per character surface (grid, detail).
 */
export function useCharactersRealtime(): void {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const { user } = useAuth();
  useEffect(() => {
    // No session → negotiate would just 401; the query layer refetches on auth.
    if (!user) return;
    const client = getAssetsRealtimeKernel({ workspaceId: workspaceId ?? undefined }).subscribe({
      onEvent: (event) => {
        if (event.kind !== "character_media_updated") return;
        void queryClient.invalidateQueries({
          queryKey: charactersKeys.detail(event.characterId),
        });
        void queryClient.invalidateQueries({ queryKey: charactersKeys.lists() });
      },
    });
    return () => client.close();
  }, [queryClient, user, workspaceId]);
}
