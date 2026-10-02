"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/app/_components/workspace-context";
import type { ProjectRole, WorkspaceRef } from "@/lib/collab/projects-api";
import { SkillsLaunchAnnouncement } from "@/components/project-skills/skills-launch-announcement";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import type { FizzAiCatalog } from "@/lib/canvas-authoring/generation-api";
import type { FizzAiReferenceKind } from "@/lib/canvas-authoring/generation-api";
import {
  listProjectSkillCatalog,
  listProjectSkillInstallations,
  type ProjectSkillCatalogResponse,
  type ProjectSkillInstallationsResponse,
  type ProjectSkillOwnerKind,
} from "@/lib/project-skills-api";

export type StudioWorkbenchOwner =
  | { kind: "platform_project"; projectId: string }
  | { kind: "story_project"; projectId: string };

interface ProjectContextValue {
  projectId: string;
  /**
   * The workspace this project lives in, resolved from the project id — the
   * single source for every project-scoped read (billing pot, generation,
   * uploads, realtime). Never the global active workspace: that is shared
   * across tabs and would make one project's page bill/scope to another's
   * workspace. Null only until the project resolves.
   */
  workspaceId: string | null;
  owner: StudioWorkbenchOwner;
  uploadKinds: readonly FizzAiReferenceKind[];
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
  projectSkills: {
    data: ProjectSkillInstallationsResponse | undefined;
    loading: boolean;
    error: boolean;
    retry: () => void;
  };
  projectSkillCatalog: {
    data: ProjectSkillCatalogResponse | undefined;
    loading: boolean;
    error: boolean;
    retry: () => void;
  };
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
const DEFAULT_UPLOAD_KINDS = ["image", "video", "audio"] as const;

/** Provides the project identity + the caller's role to every mode editor.
 *
 *  UI state (drawer open/close, shot selection, copilot) lives in
 *  `useProjectUIStore` (Zustand), not here. This context is for data that
 *  needs async resolution (role) or React Query (catalog) — things that
 *  don't belong in a Zustand store.
 */
export function ProjectProvider({
  projectId,
  workspaceId,
  owner,
  uploadKinds = DEFAULT_UPLOAD_KINDS,
  role,
  openShare,
  setShellInset,
  children,
}: {
  projectId: string;
  workspaceId: string | null;
  owner?: StudioWorkbenchOwner;
  uploadKinds?: readonly FizzAiReferenceKind[];
  role: ProjectRole | null;
  openShare: () => void;
  setShellInset?: (inset: ShellInset) => void;
  children: React.ReactNode;
}) {
  const resolvedOwner = useMemo<StudioWorkbenchOwner>(
    () => owner ?? { kind: "platform_project", projectId },
    [owner, projectId]
  );
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
  const skillOwnerKind: ProjectSkillOwnerKind =
    resolvedOwner.kind === "platform_project" ? "platform" : "story";
  const projectSkillsQuery = useQuery({
    queryKey: ["project-skills", "installations", skillOwnerKind, resolvedOwner.projectId],
    queryFn: () => listProjectSkillInstallations(skillOwnerKind, resolvedOwner.projectId),
    staleTime: 10_000,
  });
  const projectSkillCatalogQuery = useQuery({
    queryKey: ["project-skills", "catalog", skillOwnerKind, resolvedOwner.projectId],
    queryFn: () =>
      listProjectSkillCatalog({ ownerKind: skillOwnerKind, projectId: resolvedOwner.projectId }),
    staleTime: 10_000,
  });
  const {
    data: projectSkillsData,
    isPending: projectSkillsPending,
    isError: projectSkillsError,
    refetch: refetchProjectSkills,
  } = projectSkillsQuery;
  const {
    data: projectSkillCatalogData,
    isPending: projectSkillCatalogPending,
    isError: projectSkillCatalogError,
    refetch: refetchProjectSkillCatalog,
  } = projectSkillCatalogQuery;
  const projectSkills = useMemo(
    () => ({
      data: projectSkillsData,
      loading: projectSkillsPending,
      error: projectSkillsError,
      retry: () => void refetchProjectSkills(),
    }),
    [projectSkillsData, projectSkillsError, projectSkillsPending, refetchProjectSkills]
  );
  const projectSkillCatalog = useMemo(
    () => ({
      data: projectSkillCatalogData,
      loading: projectSkillCatalogPending,
      error: projectSkillCatalogError,
      retry: () => void refetchProjectSkillCatalog(),
    }),
    [
      projectSkillCatalogData,
      projectSkillCatalogError,
      projectSkillCatalogPending,
      refetchProjectSkillCatalog,
    ]
  );

  const value = useMemo<ProjectContextValue>(() => {
    const canEdit = role === "owner" || role === "admin" || role === "editor";
    const canManage = role === "owner" || role === "admin";
    return {
      projectId,
      workspaceId,
      owner: resolvedOwner,
      uploadKinds,
      role,
      canEdit,
      canManage,
      openShare,
      setShellInset: setShellInset ?? noopShellInset,
      catalog,
      projectSkills,
      projectSkillCatalog,
    };
  }, [
    projectId,
    workspaceId,
    resolvedOwner,
    uploadKinds,
    role,
    openShare,
    setShellInset,
    catalog,
    projectSkills,
    projectSkillCatalog,
  ]);

  return (
    <ProjectContext.Provider value={value}>
      {children}
      <SkillsLaunchAnnouncement catalog={projectSkillCatalog.data} />
    </ProjectContext.Provider>
  );
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

/** Project-owned credits always follow the open project's workspace. */
export function useProjectPayerWorkspace(): WorkspaceRef | null {
  const project = useOptionalProjectContext();
  const { workspaces, activeWorkspace } = useWorkspace();
  if (project) {
    if (!project.workspaceId) return null;
    const projectWs = workspaces.find((w) => w.id === project.workspaceId) ?? null;
    return projectWs;
  }
  return activeWorkspace;
}
