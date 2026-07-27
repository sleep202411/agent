"use client";

import { useEffect, useRef, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { WORKSPACES_QUERY_KEY, useWorkspace } from "@/app/_components/workspace-context";
import { getStoryProjectWorkspace } from "@/lib/story-projects-api";

/**
 * Makes a shared story-project link open for an invited member.
 *
 * A project URL carries no workspace, so a first-time invitee lands with their
 * OWN personal workspace active; every `x-fizz-workspace-id`-scoped read of the
 * project then misses and the route dead-ends on not-found. This gate asks the
 * server which workspace the project lives in — the one project read that is
 * workspace-agnostic — and switches to it before the route loads.
 *
 * It resolves up front rather than reacting to a failed read: the answer then
 * exists before any scoped query can fail, so the route never flashes
 * not-found while a switch is still possible. The cost is one small request
 * ahead of the project's own reads.
 *
 * A project route is only coherent inside the workspace that owns the project,
 * so the correction stands for as long as the route is mounted: picking another
 * workspace from the header here returns to the owning one instead of breaking
 * the page.
 */

export function storyProjectWorkspaceQueryKey(projectId: string) {
  return ["story-project-workspace", projectId] as const;
}

/**
 * Every workspace-scoped Story Studio read of one project — workbench,
 * canvas-layout, current-release, candidate-assets — all of which carry the
 * project id in their key. Dropped on a switch so the miss that sent us here
 * cannot be re-served from the pre-switch key.
 *
 * The resolve query deliberately lives outside the `story-studio` namespace so
 * this sweep can never drop it and send the gate resolving in a loop.
 */
export function isWorkspaceScopedStoryProjectQueryKey(
  queryKey: readonly unknown[],
  projectId: string
): boolean {
  return queryKey[0] === "story-studio" && queryKey.includes(projectId);
}

export type StoryProjectWorkspaceGateState = "resolving" | "switching" | "open";

export function useStoryProjectWorkspaceGate(projectId: string): StoryProjectWorkspaceGateState {
  const queryClient = useQueryClient();
  const { workspaces, activeWorkspace, setActiveWorkspaceId, loading } = useWorkspace();
  // Fire-once guard for the workspace-list refresh, plus the settled signal the
  // render below needs: without it a list that legitimately lacks the resolved
  // workspace would hold the gate on "switching" forever.
  const listRefreshStartedRef = useRef(false);
  const [listRefreshSettled, setListRefreshSettled] = useState(false);

  const resolveQuery = useQuery({
    queryKey: storyProjectWorkspaceQueryKey(projectId),
    queryFn: () => getStoryProjectWorkspace(projectId),
    // Without a workspace list there is nowhere to switch to (signed out, or the
    // context is still hydrating), and the route owns that state itself.
    enabled: !loading && workspaces.length > 0,
    // At most one resolve per project. A failure is a real answer — the caller
    // cannot reach the project — not a transient, so no retry and no refetch on
    // mount/focus/reconnect can turn "no access" into a request loop, and
    // navigating between the project's own routes never asks twice.
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const resolvedWorkspaceId = resolveQuery.data ?? null;
  const switchNeeded = resolvedWorkspaceId !== null && resolvedWorkspaceId !== activeWorkspace?.id;
  const resolvedIsListed = workspaces.some((workspace) => workspace.id === resolvedWorkspaceId);

  useEffect(() => {
    if (!switchNeeded || resolvedWorkspaceId === null) return;
    if (!resolvedIsListed) {
      // The active workspace is DERIVED by finding the selected id in the loaded
      // list, falling back to personal when the find misses — so selecting a
      // workspace a stale list has never seen is a silent no-op. A session that
      // was already open when the invite landed holds exactly such a list, so
      // refresh it once; the server lists every active membership, viewer seats
      // included. Invalidated directly rather than through the context's
      // fire-and-forget `refresh()` because the gate has to know when the
      // refreshed list is authoritative.
      if (listRefreshStartedRef.current) return;
      listRefreshStartedRef.current = true;
      void queryClient
        .invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
        .finally(() => setListRefreshSettled(true));
      return;
    }
    // Drop the project's workspace-scoped reads before re-pointing the header:
    // they are parked under the previous workspace's keys holding the miss.
    void queryClient.invalidateQueries({
      predicate: (query) => isWorkspaceScopedStoryProjectQueryKey(query.queryKey, projectId),
    });
    setActiveWorkspaceId(resolvedWorkspaceId);
  }, [
    projectId,
    queryClient,
    resolvedIsListed,
    resolvedWorkspaceId,
    setActiveWorkspaceId,
    switchNeeded,
  ]);

  if (loading) return "resolving";
  if (workspaces.length === 0) return "open";
  if (resolveQuery.isPending) return "resolving";
  if (!switchNeeded) return "open";
  if (resolvedIsListed) return "switching";
  // A resolved workspace the refreshed list still does not contain can never
  // become active, so stop waiting and let the route show its no-access state.
  return listRefreshSettled ? "open" : "switching";
}

export function StoryProjectWorkspaceGate({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("storyStudio.projectWorkspace");
  const state = useStoryProjectWorkspaceGate(projectId);
  if (state === "open") return <>{children}</>;
  return (
    <main className="grid min-h-[calc(100vh-64px)] w-full flex-1 place-items-center px-6">
      <div className="flex items-center gap-3 text-sm text-white/54">
        <IconLoader2 className="size-5 animate-spin" />
        {state === "switching" ? t("switching") : t("resolving")}
      </div>
    </main>
  );
}
