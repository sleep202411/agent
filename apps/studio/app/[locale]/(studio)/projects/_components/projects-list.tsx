"use client";

import { useQuery } from "@tanstack/react-query";
import { IconLoader2 } from "@tabler/icons-react";
import { useAuth } from "@/app/_components/auth-provider";
import { ProjectCard } from "@/components/project-card";
import { listMyLegacyProjects } from "@/lib/legacy-projects";
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

  const ownerName = user.nickName?.trim() || user.email || user.phone || "Me";

  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((project) => (
        <ProjectCard
          key={project.id}
          name={project.name}
          ownerName={ownerName}
          metaLabel={formatDate(project.updatedAt)}
          cover={project.cover}
          showWorkflowPreview={!project.cover}
        />
      ))}
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
