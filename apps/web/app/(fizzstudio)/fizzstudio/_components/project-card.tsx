"use client";

import Link from "next/link";
import { IconArrowUpRight, IconPlayerPlayFilled } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { FizzProject } from "../../_lib/api";
import { PROJECT_PREVIEW_ASSETS } from "../_data/preview-data";

interface ProjectCardProps {
  className?: string;
  project: FizzProject;
}

function projectPreviewIndex(projectId: string) {
  return (
    Array.from(projectId).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    PROJECT_PREVIEW_ASSETS.length
  );
}

export function ProjectCard({ className, project }: ProjectCardProps) {
  const t = useTranslations("fizzStudio");
  const locale = useLocale() as Locale;
  const href = localizePath(`/fizzstudio/projects/${project.id}`, locale);
  const preview = PROJECT_PREVIEW_ASSETS[projectPreviewIndex(project.id)]!;

  return (
    <article
      className={cn(
        "group relative flex h-[184px] min-w-0 cursor-pointer items-end justify-between gap-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#171719] p-3 shadow-sm shadow-black/25 transition duration-200 hover:border-white/[0.18] hover:bg-[#202023]",
        className
      )}
      style={{ boxShadow: `0 8px 28px rgba(0,0,0,.22), 0 0 28px ${preview.accentColor}0f` }}
    >
      <Link
        href={href}
        aria-label={t("projects.openProject", { name: project.name })}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      />

      <div className="pointer-events-none relative z-20 flex min-h-full min-w-0 max-w-[40%] flex-1 flex-col justify-end pb-1">
        <h3 className="line-clamp-5 text-base font-semibold leading-tight text-white">
          {project.name}
        </h3>
      </div>

      <div className="pointer-events-none relative z-20 h-full w-[60%] shrink-0 overflow-hidden rounded-xl bg-[#27272a] ring-1 ring-white/[0.06]">
        <div
          className="absolute inset-0 bg-cover bg-center transition duration-300 group-hover:scale-[1.035] group-hover:brightness-105"
          style={{
            backgroundImage: `url(${preview.posterUrl})`,
            backgroundPosition: preview.objectPosition ?? "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/10 via-transparent to-black/35" />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-14 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            background: `linear-gradient(180deg, transparent, ${preview.accentColor}24 50%, rgba(0,0,0,.62))`,
          }}
        />
      </div>

      <Link
        href={href}
        aria-label={t("projects.openProject", { name: project.name })}
        className="absolute right-4 top-4 z-30 flex size-8 translate-y-1 items-center justify-center rounded-full bg-black/60 text-white opacity-0 shadow-lg shadow-black/35 backdrop-blur-md transition duration-200 hover:bg-black/80 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <IconArrowUpRight className="size-4" />
      </Link>

      <Link
        href={href}
        className="absolute bottom-4 right-4 z-30 inline-flex h-8 translate-y-1 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-[#111] opacity-0 shadow-lg shadow-black/35 transition duration-200 hover:scale-[1.03] group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <IconPlayerPlayFilled className="size-3.5" />
        {t("projects.use")}
      </Link>
    </article>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="flex h-[184px] min-w-0 animate-pulse items-end justify-between gap-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#171719] p-3">
      <div className="mb-1 h-5 w-[34%] rounded bg-white/[0.08]" />
      <div className="h-full w-[60%] rounded-xl bg-white/[0.06]" />
    </div>
  );
}
