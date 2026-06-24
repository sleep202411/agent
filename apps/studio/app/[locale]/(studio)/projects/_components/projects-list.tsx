"use client";

import { useQuery } from "@tanstack/react-query";
import { IconPlus } from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { SectionHeading } from "@/components/ui/section-heading";
import { TileCard } from "@/components/ui/tile-card";
import { useAuth } from "@/app/_components/auth-provider";
import { ProjectCard } from "@/components/project-card";
import { listMyLegacyProjects } from "@/lib/legacy-projects";

/**
 * "My history projects" — the user's legacy projects, with a "New project"
 * create tile up front (mirrors the canvas section's New Canvas tile). Legacy
 * project creation isn't wired yet, so the tile is a coming-soon affordance.
 * Hidden entirely when signed out.
 */
export function ProjectsList() {
  const t = useTranslations("studioModes");
  const tp = useTranslations("projects");
  const locale = useLocale();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["legacy-projects", "my", user?.id ?? "anon"],
    queryFn: listMyLegacyProjects,
    enabled: !!user,
    staleTime: 30_000,
  });

  if (!user) return null;

  const items = data ?? [];
  const ownerName = user.nickName?.trim() || user.email || user.phone || "Me";
  // Legacy projects live in apps/web (fizzdragon.com / .cn for zh-CN), not the
  // studio — link out to their workspace there.
  const webBase = locale === "zh-CN" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";

  return (
    <section>
      <SectionHeading
        as="h2"
        title={t("projects.historyTitle")}
        subtitle={t("projects.historySubtitle")}
      />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <button
          type="button"
          onClick={() => toast.info(tp("projectsComingSoon"))}
          className="group block text-left outline-none"
        >
          <TileCard
            title={tp("newProject")}
            meta={tp("projectsComingSoon")}
            media={
              <span className="grid size-12 place-items-center rounded-full bg-[#E52227] text-white shadow-lg shadow-[#E52227]/25 transition group-hover:brightness-110">
                <IconPlus className="size-6" stroke={2} />
              </span>
            }
          />
        </button>

        {isLoading
          ? null
          : items.map((project) => (
              <ProjectCard
                key={project.id}
                name={project.name}
                ownerName={ownerName}
                metaLabel={formatDate(project.updatedAt)}
                cover={project.cover}
                href={`${webBase}/${locale}/projects/${project.id}`}
              />
            ))}
      </div>
    </section>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
