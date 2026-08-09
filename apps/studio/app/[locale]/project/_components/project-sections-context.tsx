"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  archiveProjectSection,
  createProjectSection,
  listProjectSections,
  reorderProjectSections,
  updateProjectSection,
  type ProjectSectionRef,
  type ProjectSectionsCollection,
} from "@/lib/collab/projects-api";

type ProjectSectionsStatus = "loading" | "ready" | "error";

interface ProjectSectionsContextValue {
  projectId: string;
  sections: ProjectSectionRef[];
  activeSection: ProjectSectionRef | null;
  status: ProjectSectionsStatus;
  error: Error | null;
  selectSection: (sectionId: string) => void;
  createSection: (title: string) => Promise<ProjectSectionRef>;
  renameSection: (sectionId: string, title: string) => Promise<void>;
  reorderSections: (sectionIds: string[]) => Promise<void>;
  archiveSection: (sectionId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const ProjectSectionsContext = createContext<ProjectSectionsContextValue | null>(null);
const EMPTY_SECTIONS: ProjectSectionRef[] = [];

export function ProjectSectionsProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["project-sections", projectId] as const, [projectId]);
  const query = useQuery({
    queryKey,
    queryFn: () => listProjectSections(projectId),
    staleTime: 10_000,
  });
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSectionId = searchParams.get("section");
  const sections = useMemo(() => query.data?.sections ?? EMPTY_SECTIONS, [query.data?.sections]);
  const activeSection = requestedSectionId
    ? (sections.find((section) => section.id === requestedSectionId) ?? null)
    : (sections[0] ?? null);

  const replaceSectionInUrl = useCallback(
    (sectionId: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("section", sectionId);
      next.delete("focus");
      next.delete("row");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!requestedSectionId && sections[0]) replaceSectionInUrl(sections[0].id);
  }, [replaceSectionInUrl, requestedSectionId, sections]);

  const accept = useCallback(
    (collection: ProjectSectionsCollection) => {
      queryClient.setQueryData(queryKey, collection);
      return collection;
    },
    [queryClient, queryKey]
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const mutate = useCallback(
    async (operation: () => Promise<ProjectSectionsCollection>) => {
      try {
        return accept(await operation());
      } catch (error) {
        await refresh();
        throw error;
      }
    },
    [accept, refresh]
  );

  const selectSection = useCallback(
    (sectionId: string) => {
      if (!sections.some((section) => section.id === sectionId)) {
        throw new Error("Cannot select a chapter outside this project.");
      }
      replaceSectionInUrl(sectionId);
    },
    [replaceSectionInUrl, sections]
  );

  const createSection = useCallback(
    async (title: string) => {
      if (!query.data) throw new Error("The chapter collection is not ready.");
      const beforeIds = new Set(query.data.sections.map((section) => section.id));
      const result = await mutate(() =>
        createProjectSection(projectId, {
          title,
          expectedProjectVersion: query.data!.projectVersion,
        })
      );
      const created = result.sections.find((section) => !beforeIds.has(section.id));
      if (!created) throw new Error("The created chapter was missing from the response.");
      replaceSectionInUrl(created.id);
      return created;
    },
    [mutate, projectId, query.data, replaceSectionInUrl]
  );

  const renameSection = useCallback(
    async (sectionId: string, title: string) => {
      const section = sections.find((candidate) => candidate.id === sectionId);
      if (!section) throw new Error("Chapter not found.");
      await mutate(() =>
        updateProjectSection(projectId, sectionId, {
          title,
          expectedVersion: section.version,
        })
      );
    },
    [mutate, projectId, sections]
  );

  const reorderSections = useCallback(
    async (sectionIds: string[]) => {
      if (!query.data) throw new Error("The chapter collection is not ready.");
      await mutate(() =>
        reorderProjectSections(projectId, {
          sectionIds,
          expectedProjectVersion: query.data!.projectVersion,
        })
      );
    },
    [mutate, projectId, query.data]
  );

  const archiveSection = useCallback(
    async (sectionId: string) => {
      if (!query.data) throw new Error("The chapter collection is not ready.");
      const section = query.data.sections.find((candidate) => candidate.id === sectionId);
      if (!section) throw new Error("Chapter not found.");
      const oldIndex = query.data.sections.findIndex((candidate) => candidate.id === sectionId);
      const result = await mutate(() =>
        archiveProjectSection(projectId, sectionId, {
          expectedProjectVersion: query.data!.projectVersion,
          expectedSectionVersion: section.version,
        })
      );
      if (requestedSectionId === sectionId) {
        const replacement = result.sections[Math.min(oldIndex, result.sections.length - 1)];
        if (!replacement) throw new Error("A project must keep an active chapter.");
        replaceSectionInUrl(replacement.id);
      }
    },
    [mutate, projectId, query.data, replaceSectionInUrl, requestedSectionId]
  );

  const invalidSelection = query.isSuccess && Boolean(requestedSectionId) && activeSection === null;
  const error = useMemo(
    () => (invalidSelection ? new Error("") : query.error instanceof Error ? query.error : null),
    [invalidSelection, query.error]
  );
  const status: ProjectSectionsStatus = query.isPending ? "loading" : error ? "error" : "ready";

  const value = useMemo<ProjectSectionsContextValue>(
    () => ({
      projectId,
      sections,
      activeSection,
      status,
      error,
      selectSection,
      createSection,
      renameSection,
      reorderSections,
      archiveSection,
      refresh,
    }),
    [
      projectId,
      sections,
      activeSection,
      status,
      error,
      selectSection,
      createSection,
      renameSection,
      reorderSections,
      archiveSection,
      refresh,
    ]
  );

  return (
    <ProjectSectionsContext.Provider value={value}>{children}</ProjectSectionsContext.Provider>
  );
}

export function useProjectSections(): ProjectSectionsContextValue {
  const value = useContext(ProjectSectionsContext);
  if (!value) throw new Error("useProjectSections must be used within ProjectSectionsProvider");
  return value;
}

export function useOptionalProjectSections(): ProjectSectionsContextValue | null {
  return useContext(ProjectSectionsContext);
}
