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
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Provides the project identity + the caller's role to every mode editor. */
export function ProjectProvider({
  projectId,
  role,
  children,
}: {
  projectId: string;
  role: ProjectRole | null;
  children: React.ReactNode;
}) {
  const value = useMemo<ProjectContextValue>(() => {
    // Unknown role (older server / not yet loaded): default to editable so the
    // existing single-user flow isn't blocked; the server still enforces writes.
    const canEdit = role == null ? true : role !== "viewer";
    const canManage = role === "owner" || role === "admin";
    return { projectId, role, canEdit, canManage };
  }, [projectId, role]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) {
    throw new Error("useProjectContext must be used within a ProjectProvider");
  }
  return value;
}
