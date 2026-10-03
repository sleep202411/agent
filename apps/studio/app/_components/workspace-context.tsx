"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { setApiWorkspaceId } from "@/lib/api";
import {
  createWorkspace as createWorkspaceRequest,
  ensureDefaultWorkspace,
  listWorkspaces,
  type WorkspaceRef,
} from "@/lib/collab/projects-api";
import { useAuth } from "./auth-provider";

/**
 * Active-workspace context. Lists every workspace the user belongs to,
 * tracks the selected one (persisted to localStorage),
 * and exposes workspace creation. The projects grid + switcher are scoped to the
 * active workspace, so switching workspaces re-scopes the whole surface.
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
  createWorkspace: (
    name: string,
    description?: string,
    avatarUrl?: string,
    signal?: AbortSignal
  ) => Promise<WorkspaceRef>;
  refresh: () => void;
  loading: boolean;
  error: Error | null;
  fetching: boolean;
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
 * back to the caller's default-workspace pot.
 */
export function useActiveWorkspaceId(): string | null {
  return useContext(WorkspaceContext)?.activeWorkspace?.id ?? null;
}

/** Active workspace, or null when no provider is mounted. */
export function useActiveWorkspace(): WorkspaceRef | null {
  return useContext(WorkspaceContext)?.activeWorkspace ?? null;
}

/** The active workspace is the payer outside a project. */
export function useBillingWorkspace(): WorkspaceRef | null {
  return useActiveWorkspace();
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const requestedId = useSearchParams().get("ws");
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const userKey = user?.id == null ? "anonymous" : String(user.id);
  const owner = useRef<{ key: string; controller: AbortController } | null>(null);
  const selectionVersion = useRef(0);
  useLayoutEffect(() => {
    const current = { key: userKey, controller: new AbortController() };
    owner.current = current;
    return () => {
      current.controller.abort();
      if (owner.current === current) owner.current = null;
    };
  }, [userKey]);

  const {
    data: loadedWorkspaces = EMPTY_WORKSPACES,
    isLoading,
    error,
    isFetching,
  } = useQuery({
    queryKey: [...WORKSPACES_QUERY_KEY, userKey] as const,
    // Ensure the default workspace exists, then list all memberships.
    queryFn: async ({ signal }) => {
      await ensureDefaultWorkspace(signal);
      signal.throwIfAborted();
      return listWorkspaces(signal);
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
    // An explicit notification target must never silently open another team.
    if (requestedId) return workspaces.find((w) => w.id === requestedId) ?? null;
    return (
      workspaces.find((w) => w.id === activeId) ??
      workspaces.find((w) => w.isDefault) ??
      workspaces[0]
    );
  }, [workspaces, activeId, requestedId]);

  // Scope every /aurora request (reads + AI-generation spend) to the active
  // workspace, so compute_point spend and the displayed balance stay in lockstep.
  useEffect(() => {
    setApiWorkspaceId(activeWorkspace?.id ?? null);
  }, [activeWorkspace?.id]);

  const setActiveWorkspaceId = useCallback(
    (id: string) => {
      if (owner.current?.key !== userKey || owner.current.controller.signal.aborted) return;
      selectionVersion.current += 1;
      setActiveId(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      const url = new URL(window.location.href);
      if (url.searchParams.has("ws") && url.searchParams.get("ws") !== id) {
        url.searchParams.set("ws", id);
        window.history.replaceState(null, "", url);
      }
    },
    [userKey]
  );

  useEffect(() => {
    if (requestedId && activeWorkspace?.id === requestedId) {
      // URL navigation is an external selection change; persist it for subsequent pages.
      setActiveWorkspaceId(requestedId);
    }
  }, [requestedId, activeWorkspace?.id, setActiveWorkspaceId]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
  }, [queryClient]);

  const createWorkspace = useCallback(
    async (name: string, description?: string, avatarUrl?: string, callerSignal?: AbortSignal) => {
      const current = owner.current;
      if (!user || !current || current.key !== userKey)
        throw new DOMException("Workspace session changed", "AbortError");
      const signal = AbortSignal.any([
        current.controller.signal,
        ...(callerSignal ? [callerSignal] : []),
      ]);
      signal.throwIfAborted();
      const selectedAtStart = selectionVersion.current;
      const trimmed = description?.trim();
      const workspace = await createWorkspaceRequest(
        { name, ...(trimmed ? { description: trimmed } : {}), ...(avatarUrl ? { avatarUrl } : {}) },
        signal
      );
      signal.throwIfAborted();
      await queryClient.invalidateQueries({
        queryKey: [...WORKSPACES_QUERY_KEY, userKey],
        exact: true,
      });
      signal.throwIfAborted();
      if (selectionVersion.current === selectedAtStart) setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [queryClient, setActiveWorkspaceId, user, userKey]
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      setActiveWorkspaceId,
      createWorkspace,
      refresh,
      loading: authLoading || (Boolean(user) && isLoading),
      error: user ? error : null,
      fetching: Boolean(user) && isFetching,
    }),
    [
      workspaces,
      activeWorkspace,
      setActiveWorkspaceId,
      createWorkspace,
      refresh,
      authLoading,
      user,
      isLoading,
      error,
      isFetching,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
