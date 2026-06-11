"use client";

import Link from "next/link";
import { IconDots, IconFolderPlus, IconPhoto, IconPlus, IconSparkles } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { FizzProject } from "../../_lib/api";
import { PROJECT_PREVIEW_ASSETS } from "../_data/preview-data";
import { ProjectCard, ProjectCardSkeleton } from "./project-card";

interface ProjectsSectionBaseProps {
  isLoading: boolean;
  onCreateProject: () => void;
  projects: FizzProject[];
  workspaceReady: boolean;
}

interface RecentProjectsSectionProps extends ProjectsSectionBaseProps {
  currentLocale: Locale;
}

export function RecentProjectsSection({
  currentLocale,
  isLoading,
  onCreateProject,
  projects,
  workspaceReady,
}: RecentProjectsSectionProps) {
  const t = useTranslations("fizzStudio");
  const visibleProjects = projects.slice(0, 4);

  return (
    <section aria-labelledby="recent-projects" className="mt-14">
      <div className="flex items-center justify-between gap-4">
        <h2
          id="recent-projects"
          className="text-xl font-semibold leading-tight tracking-[-0.01em] text-white"
        >
          {t("projects.recentTitle")}
        </h2>
        <Link
          href={localizePath("/fizzstudio/projects", currentLocale)}
          className="shrink-0 text-sm font-semibold text-white/86 transition-colors hover:text-white"
        >
          {t("projects.showAll")}
        </Link>
      </div>

      <div className="mt-5 flex w-full flex-wrap items-stretch gap-4">
        <RecentCreateProjectCard disabled={!workspaceReady} onCreateProject={onCreateProject} />
        {isLoading ? (
          <>
            <RecentProjectSkeleton />
            <RecentProjectSkeleton />
          </>
        ) : (
          visibleProjects.map((project) => (
            <RecentProjectCard key={project.id} currentLocale={currentLocale} project={project} />
          ))
        )}
      </div>
    </section>
  );
}

export function AllProjectsSurface({
  isLoading,
  onCreateProject,
  projects,
  workspaceReady,
}: ProjectsSectionBaseProps) {
  const t = useTranslations("fizzStudio");

  if (!isLoading && projects.length === 0) {
    return (
      <ProjectsEmptyState
        className="min-h-[calc(100vh-12rem)]"
        disabled={!workspaceReady}
        onCreateProject={onCreateProject}
        variant="page"
      />
    );
  }

  return (
    <section aria-labelledby="all-projects" className="pb-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            id="all-projects"
            className="text-[30px] font-semibold leading-tight tracking-[-0.015em] text-white"
          >
            {t("projects.allTitle")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/46">
            {t("projects.allSubtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateProject}
          disabled={!workspaceReady}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#111] shadow-lg shadow-black/20 transition hover:scale-[1.02] disabled:pointer-events-none disabled:opacity-50"
        >
          <IconPlus className="size-4" />
          {t("createProject")}
        </button>
      </div>

      <ProjectGrid className="mt-6" isLoading={isLoading} projects={projects} skeletonCount={9} />
    </section>
  );
}

function projectPreviewIndex(projectId: string) {
  return (
    Array.from(projectId).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    PROJECT_PREVIEW_ASSETS.length
  );
}

function formatRelativeTime(value: string, locale: Locale) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(diffSeconds) >= secondsPerUnit) {
      return formatter.format(Math.round(diffSeconds / secondsPerUnit), unit);
    }
  }

  return formatter.format(diffSeconds, "second");
}

function RecentCreateProjectCard({
  disabled,
  onCreateProject,
}: {
  disabled: boolean;
  onCreateProject: () => void;
}) {
  const t = useTranslations("fizzStudio");

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onCreateProject}
      className="group flex h-[164px] w-full max-w-[410px] flex-none flex-col items-center justify-center gap-5 rounded-[22px] border border-white/[0.08] bg-[#171719] text-center shadow-[0_16px_50px_rgba(0,0,0,.32)] transition duration-200 hover:border-white/[0.16] hover:bg-[#202023] disabled:pointer-events-none disabled:opacity-50 sm:basis-[410px]"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-white text-[#111] transition group-hover:scale-105">
        <IconPlus className="size-5" stroke={1.9} />
      </span>
      <span className="text-base font-semibold text-white">
        {t("enterpriseHome.createNewProject")}
      </span>
    </button>
  );
}

function RecentProjectCard({
  currentLocale,
  project,
}: {
  currentLocale: Locale;
  project: FizzProject;
}) {
  const t = useTranslations("fizzStudio");
  const href = localizePath(`/fizzstudio/projects/${project.id}`, currentLocale);
  const preview = PROJECT_PREVIEW_ASSETS[projectPreviewIndex(project.id)]!;

  return (
    <article className="group relative h-[164px] w-full max-w-[520px] flex-none overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#171719] p-3 shadow-[0_16px_50px_rgba(0,0,0,.32)] transition duration-200 hover:border-white/[0.16] hover:bg-[#202023] sm:basis-[520px]">
      <Link
        href={href}
        aria-label={t("projects.openProject", { name: project.name })}
        className="absolute inset-0 z-10 rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      />
      <div className="relative z-20 flex h-full gap-4">
        <div className="h-full w-[42%] shrink-0 overflow-hidden rounded-2xl bg-[#242426] ring-1 ring-white/[0.04]">
          <div
            className="size-full bg-cover bg-center opacity-72 transition duration-300 group-hover:scale-[1.035] group-hover:opacity-90"
            style={{
              backgroundImage: `url(${preview.posterUrl})`,
              backgroundPosition: preview.objectPosition ?? "center",
            }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col py-1">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold leading-tight text-white">
                {project.name}
              </h3>
              <p className="mt-1 text-sm leading-none text-white/58">
                {formatRelativeTime(project.updatedAt, currentLocale)}
              </p>
            </div>
            <span className="pointer-events-none relative z-30 flex size-8 shrink-0 items-center justify-center rounded-full text-white/78">
              <IconDots className="size-5" stroke={2} />
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="inline-flex h-6 items-center gap-1 rounded-lg bg-white/[0.06] px-2 text-xs font-medium text-white/62">
              <IconPhoto className="size-3.5" stroke={1.8} />
              {t("projects.assetsCount", { count: 0 })}
            </span>
            <span className="inline-flex h-6 items-center gap-1 rounded-lg bg-white/[0.06] px-2 text-xs font-medium text-white/62">
              <IconSparkles className="size-3.5" stroke={1.8} />
              {t("projects.creditsCount", { count: 0 })}
            </span>
          </div>

          <div className="mt-auto flex items-center gap-2 text-sm text-white/86">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#7a4a21] text-xs font-semibold text-white">
              {t("projects.creatorInitial")}
            </span>
            <span className="truncate">{t("projects.creatorFallback")}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function RecentProjectSkeleton() {
  return (
    <div className="flex h-[164px] w-full max-w-[520px] flex-none animate-pulse gap-4 rounded-[22px] border border-white/[0.06] bg-[#171719] p-3 sm:basis-[520px]">
      <div className="h-full w-[42%] rounded-2xl bg-white/[0.06]" />
      <div className="flex flex-1 flex-col gap-3 py-1">
        <div className="h-5 w-1/2 rounded bg-white/[0.08]" />
        <div className="h-4 w-1/3 rounded bg-white/[0.06]" />
        <div className="mt-auto h-6 w-24 rounded bg-white/[0.06]" />
      </div>
    </div>
  );
}

function ProjectGrid({
  className,
  isLoading,
  projects,
  skeletonCount = 6,
}: {
  className?: string;
  isLoading: boolean;
  projects: FizzProject[];
  skeletonCount?: number;
}) {
  if (isLoading) {
    return (
      <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", className)}>
        {Array.from({ length: skeletonCount }).map((_, index) => (
          <ProjectCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (projects.length === 0) return null;

  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", className)}>
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

function ProjectsEmptyState({
  className,
  disabled,
  onCreateProject,
  variant,
}: {
  className?: string;
  disabled: boolean;
  onCreateProject: () => void;
  variant: "page" | "section";
}) {
  const t = useTranslations("fizzStudio");
  const isPage = variant === "page";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[28px] text-center",
        isPage ? "bg-transparent" : "border border-dashed border-white/[0.1] bg-white/[0.025] px-6",
        className
      )}
    >
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-[#18181a] text-white shadow-lg shadow-black/25">
        {isPage ? <IconFolderPlus className="size-6" /> : <IconSparkles className="size-6" />}
      </div>
      <h2 className="text-xl font-semibold text-white">{t("projects.emptyTitle")}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-white/48">{t("projects.emptyBody")}</p>
      <button
        type="button"
        onClick={onCreateProject}
        disabled={disabled}
        className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#111] shadow-lg shadow-black/20 transition hover:scale-[1.02] disabled:pointer-events-none disabled:opacity-50"
      >
        <IconPlus className="size-4" />
        {t("projects.emptyAction")}
      </button>
    </div>
  );
}
