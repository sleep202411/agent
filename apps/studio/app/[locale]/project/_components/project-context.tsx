"use client";

import { createContext, useContext, useMemo } from "react";
import type { ProjectRole } from "@/lib/collab/projects-api";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import type { FizzAiCatalog } from "@/lib/canvas-authoring/generation-api";

interface ProjectContextValue {
  projectId: string;
  /** The caller's effective role (null until resolved / no access). */
  role: ProjectRole | null;
  /** Can mutate content (owner/admin/editor). Server is the source of truth;
   *  this only gates UI affordances so a viewer doesn't hit write errors. */
  canEdit: boolean;
  /** Can manage sharing/members (owner/admin). */
  canManage: boolean;
  /** Opens the project share/members dialog (owned by the project shell), so any
   *  mode's own toolbar can host the Share button without owning the dialog. */
  openShare: () => void;
  /**
   * Legacy: a no-op now. The shell uses flex push, so no chrome位移 is needed.
   * Kept as a stable no-op so canvas internals that still read it don't crash.
   */
  setShellInset: (inset: ShellInset) => void;
  /**
   * The AI model catalog, fetched ONCE for the project and shared by every
   * mode. Its loading and error states travel with it, so a surface that needs
   * models can say "still loading" or "couldn't load" instead of showing an
   * empty list and letting the two look like "there are no models".
   */
  catalog: ProjectCatalog;
}

export interface ProjectCatalog {
  data: FizzAiCatalog | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

export interface ShellInset {
  left?: number;
  right?: number;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Provides the project identity + the caller's role to every mode editor.
 *
 *  UI state (drawer open/close, shot selection, copilot) lives in
 *  `useProjectUIStore` (Zustand), not here. This context is for data that
 *  needs async resolution (role) or React Query (catalog) — things that
 *  don't belong in a Zustand store.
 */
export function ProjectProvider({
  projectId,
  role,
  openShare,
  setShellInset,
  children,
}: {
  projectId: string;
  role: ProjectRole | null;
  openShare: () => void;
  setShellInset?: (inset: ShellInset) => void;
  children: React.ReactNode;
}) {
  const { data, isPending, isError, refetch } = useAiCatalog();
  const catalog = useMemo<ProjectCatalog>(
    () => ({
      data,
      loading: isPending,
      error: isError,
      retry: () => void refetch(),
    }),
    [data, isPending, isError, refetch]
  );

  const value = useMemo<ProjectContextValue>(() => {
    const canEdit = role == null ? true : role !== "viewer";
    const canManage = role === "owner" || role === "admin";
    return {
      projectId,
      role,
      canEdit,
      canManage,
      openShare,
      setShellInset: setShellInset ?? noopShellInset,
      catalog,
    };
  }, [projectId, role, openShare, setShellInset, catalog]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

function noopShellInset(_inset: ShellInset) {
  void _inset;
}

export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) {
    throw new Error("useProjectContext must be used within a ProjectProvider");
  }
  return value;
}

export function useOptionalProjectContext(): ProjectContextValue | null {
  return useContext(ProjectContext);
}
