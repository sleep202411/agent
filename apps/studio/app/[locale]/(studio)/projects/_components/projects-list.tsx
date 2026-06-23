"use client";

import { useQuery } from "@tanstack/react-query";
import { IconLoader2, IconPhoto } from "@tabler/icons-react";
import { useAuth } from "@/app/_components/auth-provider";
import { listMyLegacyProjects, type LegacyProject } from "@/lib/legacy-projects";
import { ProjectsEmptyState } from "./empty-state";

export function ProjectsList() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["legacy-projects", "my", user?.id ?? "anon"],
    queryFn: listMyLegacyProjects,
    enabled: !!user,
    staleTime: 30_000,
  });

  if (user && isLoading) {
    return (
      <div className="mt-12 flex justify-center">
        <IconLoader2 className="size-6 animate-spin text-white/40" />
      </div>
    );
  }

  const items = data ?? [];
  if (!user || items.length === 0) return <ProjectsEmptyState />;

  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: LegacyProject }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#151515] transition hover:border-white/[0.14]">
      <div className="relative aspect-video w-full overflow-hidden bg-[#222]">
        {project.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.cover}
            alt={project.name}
            loading="lazy"
            className="size-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <IconPhoto className="size-8 text-white/15" stroke={1.5} />
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="truncate text-sm font-medium text-white/90">{project.name}</h3>
        {project.updatedAt ? (
          <p className="mt-1 text-xs text-white/45">{formatDate(project.updatedAt)}</p>
        ) : null}
      </div>
    </article>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
