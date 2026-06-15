"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTeamWorkspace,
  ensurePersonalWorkspace,
  listWorkspaces,
  type WorkspaceRef,
} from "@/lib/collab/projects-api";

/**
 * Active-workspace context. Lists every workspace the user belongs to
 * (personal + teams), tracks the selected one (persisted to localStorage),
 * and exposes team creation. The projects grid + switcher are scoped to the
 * active workspace, so switching teams re-scopes the whole surface.
 */

const STORAGE_KEY = "fizz:active-workspace";
/** Exposed so the invite-accept flow can preselect the just-joined team. */
export const ACTIVE_WORKSPACE_STORAGE_KEY = STORAGE_KEY;
export const WORKSPACES_QUERY_KEY = ["fizzstudio", "workspaces"] as const;

interface WorkspaceContextValue {
  workspaces: WorkspaceRef[];
  activeWorkspace: WorkspaceRef | null;
  setActiveWorkspaceId: (id: string) => void;
  createTeam: (name: string, description?: string, avatarUrl?: string) => Promise<WorkspaceRef>;
  refresh: () => void;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return value;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    // Ensure the personal workspace exists, then list all memberships.
    queryFn: async () => {
      await ensurePersonalWorkspace();
      return listWorkspaces();
    },
    staleTime: 60_000,
    retry: false,
  });

  // Hydrate the persisted selection lazily (client-only; SSR returns null, and
  // the active workspace is derived from the async-loaded list so there's no
  // hydration mismatch).
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const activeWorkspace = useMemo(() => {
    if (workspaces.length === 0) return null;
    return (
      workspaces.find((w) => w.id === activeId) ??
      workspaces.find((w) => w.type === "personal") ??
      workspaces[0]
    );
  }, [workspaces, activeId]);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
  }, [queryClient]);

  const createTeam = useCallback(
    async (name: string, description?: string, avatarUrl?: string) => {
      const trimmed = description?.trim();
      const workspace = await createTeamWorkspace({
        name,
        ...(trimmed ? { description: trimmed } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [queryClient, setActiveWorkspaceId]
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      setActiveWorkspaceId,
      createTeam,
      refresh,
      loading: isLoading,
    }),
    [workspaces, activeWorkspace, setActiveWorkspaceId, createTeam, refresh, isLoading]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
