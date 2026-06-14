"use client";

import { createContext, useContext } from "react";

interface ProjectContextValue {
  projectId: string;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Provides the project identity to every mode editor mounted under the shell. */
export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  return <ProjectContext.Provider value={{ projectId }}>{children}</ProjectContext.Provider>;
}

export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) {
    throw new Error("useProjectContext must be used within a ProjectProvider");
  }
  return value;
}
