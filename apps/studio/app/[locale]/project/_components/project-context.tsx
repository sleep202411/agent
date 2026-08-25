"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { payerWorkspace, useWorkspace } from "@/app/_components/workspace-context";
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
const DEFAULT_UPLOAD_KINDS = ["image", "video"] as const;

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
    const canEdit = role == null ? true : role !== "viewer";
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

/**
 * The single workspace the current user operates in FOR the open project — the
 * one they are a member of, so it is at once the compute pot a generation debits
 * (mirrors the server payer rule `resolvePayerTx`), the realtime channel to
 * subscribe to, and the workspace an upload belongs to. It keys off the OPEN
 * PROJECT's workspace, never the global active selection, so it stays correct
 * even when a second tab switched the active workspace elsewhere; and because it
 * always resolves to a workspace the user belongs to, workspace-membership-gated
 * endpoints (realtime negotiate, media upload) never 403.
 *
 * - In a project: a team project → the team pot/channel; a personal project
 *   (mine, or a host's I only collaborate in) → MY own personal pot/channel —
 *   the one I can read and the one the server debits for a personal-workspace
 *   job. (A collaborator cannot reach the host's personal workspace, so realtime
 *   for the host's jobs degrades to reconcile-on-connect rather than 403ing.)
 * - Outside any project: the global billing workspace (active team → team pot;
 *   otherwise my personal pot).
 */
export function useProjectPayerWorkspace(): WorkspaceRef | null {
  const project = useOptionalProjectContext();
  const { workspaces, activeWorkspace } = useWorkspace();
  if (project) {
    // In a project the pot is decided by the PROJECT's workspace and nothing
    // else. While it is still resolving (workspaceId null) return null — chrome
    // shows "—" — rather than flashing the global active pot, which is the
    // cross-context leak this fixes. A host's personal workspace I only
    // collaborate in is absent from my list, so `find` misses and payerWorkspace
    // correctly falls back to my own personal pot.
    if (!project.workspaceId) return null;
    const projectWs = workspaces.find((w) => w.id === project.workspaceId) ?? null;
    return payerWorkspace(projectWs, workspaces);
  }
  return payerWorkspace(activeWorkspace, workspaces);
}
