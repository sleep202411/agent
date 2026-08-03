"use client";

import { createContext, useContext, useMemo } from "react";
import type { ProjectRole } from "@/lib/collab/projects-api";

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
   */
  setShellInset: (inset: ShellInset) => void;
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
  children,
}: {
  projectId: string;
  role: ProjectRole | null;
  openShare: () => void;
  setShellInset?: (inset: ShellInset) => void;
  children: React.ReactNode;
}) {
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
    };
  }, [projectId, role, openShare, setShellInset]);

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
