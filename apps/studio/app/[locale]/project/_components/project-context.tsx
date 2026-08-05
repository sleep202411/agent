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
   * A mode reports how much of the shell's left/right edge its panels occupy.
   *
   * The project workspace is three regions — left panels, the mode's content,
   * right panels — and the shell's own chrome (back + project name, share)
   * lives on those same edges. Reporting an inset is how a mode says "a drawer
   * is standing here", so the chrome slides aside instead of being covered.
   * Partial updates merge, so a mode can own one edge without touching the other.
   *
   * NOTE: being phased out. The shell now owns the three regions as flex columns
   * (header on top, left drawer slot + main content below, AI assistant on the
   * right) — push is done by flex, not by chrome位移. Modes should register a
   * drawer via setLeftDrawer instead. Kept temporarily to avoid breaking canvas
   * internals that still read it.
   */
  setShellInset: (inset: ShellInset) => void;
  /**
   * Register a drawer into the shell's LEFT slot. Pass null to clear. The shell
   * renders whatever node a mode registers, push-ing the main content right.
   * Replaces the old per-mode drawer mounting (canvas overlay / storyboard flex).
   */
  setLeftDrawer: (node: React.ReactNode) => void;
  /** Whether the shell-level AI assistant (right panel) is open. */
  copilotOpen: boolean;
  /** Open/close the shell-level AI assistant. */
  setCopilotOpen: (open: boolean) => void;
  /** Whether the project asset library is open. Shell-owned so the sidebar
   *  toggle and canvas both control the same panel. */
  assetsOpen: boolean;
  setAssetsOpen: (open: boolean) => void;
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

/** Provides the project identity + the caller's role to every mode editor. */
export function ProjectProvider({
  projectId,
  role,
  openShare,
  setShellInset,
  setLeftDrawer,
  copilotOpen,
  setCopilotOpen,
  assetsOpen,
  setAssetsOpen,
  children,
}: {
  projectId: string;
  role: ProjectRole | null;
  openShare: () => void;
  setShellInset?: (inset: ShellInset) => void;
  setLeftDrawer: (node: React.ReactNode) => void;
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  assetsOpen: boolean;
  setAssetsOpen: (open: boolean) => void;
  children: React.ReactNode;
}) {
  // One fetch per project. Every mode reads this instead of asking for the
  // catalog itself — React Query would dedupe the request either way, but the
  // point is that loading and failure have a single owner.
  // Destructured on purpose: useQuery returns a NEW result object every render,
  // so depending on the query itself would make this memo — and the context
  // value built from it — change identity on every render, which is an infinite
  // loop the moment any consumer's effect writes state back to the shell.
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
    // Unknown role (older server / not yet loaded): default to editable so the
    // existing single-user flow isn't blocked; the server still enforces writes.
    const canEdit = role == null ? true : role !== "viewer";
    const canManage = role === "owner" || role === "admin";
    return {
      projectId,
      role,
      canEdit,
      canManage,
      openShare,
      setShellInset: setShellInset ?? noopShellInset,
      setLeftDrawer,
      copilotOpen,
      setCopilotOpen,
      assetsOpen,
      setAssetsOpen,
      catalog,
    };
  }, [projectId, role, openShare, setShellInset, setLeftDrawer, copilotOpen, setCopilotOpen, assetsOpen, setAssetsOpen, catalog]);

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

/**
 * The project identity when there is one, else null — for shared canvas parts
 * that gain a project-only affordance (e.g. a shot's link into the storyboard
 * mode) but must still render on canvases that have no project shell.
 */
export function useOptionalProjectContext(): ProjectContextValue | null {
  return useContext(ProjectContext);
}
