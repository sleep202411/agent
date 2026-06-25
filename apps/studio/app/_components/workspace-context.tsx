"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setApiWorkspaceId } from "@/lib/api";
import {
  createTeamWorkspace,
  ensurePersonalWorkspace,
  listWorkspaces,
  type WorkspaceRef,
} from "@/lib/collab/projects-api";
import { useAuth } from "./auth-provider";

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
const EMPTY_WORKSPACES: WorkspaceRef[] = [];

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

/**
 * Active workspace id WITHOUT throwing if no provider is mounted. The
 * {@link WorkspaceProvider} is app-wide (app/providers.tsx), so this returns the
 * active workspace on every authenticated surface (the canvas included); it
 * returns null only on pre-provider / SSR first paint, where the server falls
 * back to the caller's personal-workspace pot.
 */
export function useActiveWorkspaceId(): string | null {
  return useContext(WorkspaceContext)?.activeWorkspace?.id ?? null;
}

/** Active workspace (incl. its `type`) WITHOUT throwing when no provider is
 *  mounted — lets chrome tell a personal pot from a team pot. */
export function useActiveWorkspace(): WorkspaceRef | null {
  return useContext(WorkspaceContext)?.activeWorkspace ?? null;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const userKey = user?.id == null ? "anonymous" : String(user.id);

  const { data: loadedWorkspaces = EMPTY_WORKSPACES, isLoading } = useQuery({
    queryKey: [...WORKSPACES_QUERY_KEY, userKey] as const,
    // Ensure the personal workspace exists, then list all memberships.
    queryFn: async () => {
      await ensurePersonalWorkspace();
      return listWorkspaces();
    },
    enabled: Boolean(user),
    staleTime: 60_000,
    retry: false,
  });
  const workspaces = user ? loadedWorkspaces : EMPTY_WORKSPACES;

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

  // Scope every /aurora request (reads + AI-generation spend) to the active
  // workspace, so compute_point spend and the displayed balance stay in lockstep.
  useEffect(() => {
    setApiWorkspaceId(activeWorkspace?.id ?? null);
  }, [activeWorkspace?.id]);

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
      loading: authLoading || (Boolean(user) && isLoading),
    }),
    [
      workspaces,
      activeWorkspace,
      setActiveWorkspaceId,
      createTeam,
      refresh,
      authLoading,
      user,
      isLoading,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
