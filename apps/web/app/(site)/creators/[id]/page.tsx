"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { IconArrowLeft, IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { env } from "@/src/env";
import {
  useCreatorDetail,
  useCreatorPersonalWorks,
  useCreatorProjects,
  useCreatorJoinedProjects,
  type Creator,
} from "@/app/(site)/creators/_hooks/use-creator";
import type { PersonalWork, Project } from "@/src/services/project";
import { CreatorHeader } from "./creator-header";

export default function CreatorDetailPage() {
  const t = useTranslations("creator");
  const tp = useTranslations("profile");
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data: creator, isLoading } = useCreatorDetail(id);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-bold text-foreground">{t("notFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notFoundDesc")}</p>
        <Link
          href="/creators"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <IconArrowLeft className="size-4" /> {t("back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <CreatorHeader creator={creator} />

      {/* Flat vertical stack mirrors `app/(site)/profile/page.tsx` so a
          creator looking at someone else's page sees the same section
          rhythm as their own. Tabs were removed deliberately — they
          forced users to click around for low-density data
          (about + a handful of works) where scrolling is cheaper. */}
      <div className="relative mx-auto max-w-5xl space-y-12 px-8 pb-24 pt-10">
        <OverviewSection creator={creator} />

        <CreatorSection title={tp("personalWorks")}>
          <PersonalWorksSection creatorId={creator.id} />
        </CreatorSection>

        <CreatorSection title={tp("myIPs")}>
          <ProjectsSection creatorId={creator.id} />
        </CreatorSection>

        <CreatorSection title={tp("joinedCrews")}>
          <JoinedSection creatorId={creator.id} />
        </CreatorSection>
      </div>
    </div>
  );
}

function CreatorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ─── Overview ─────────────────────────────────────────

function OverviewSection({ creator }: { creator: Creator }) {
  const t = useTranslations("creator");
  const bio = (creator.bio || "").trim();

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {t("about")}
      </h2>
      {bio ? (
        <p className="whitespace-pre-line rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-foreground">
          {bio}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground/70">{t("bioEmpty")}</p>
      )}
    </section>
  );
}

// ─── Personal Works ───────────────────────────────────

function PersonalWorksSection({ creatorId }: { creatorId: string }) {
  const tp = useTranslations("profile");
  const { data, isLoading } = useCreatorPersonalWorks(creatorId);
  const works = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (works.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        {tp("noData")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {works.map((work) => (
        <PersonalWorkCard key={work.id} work={work} />
      ))}
    </div>
  );
}

function PersonalWorkCard({ work }: { work: PersonalWork }) {
  const tp = useTranslations("profile");
  const title = (work.title || work.introduction || "").trim();
  const videoPath = work.videoLink || "";
  const bannerPath = work.videoBanner || "";
  const coverUrl = bannerPath
    ? bannerPath.startsWith("http")
      ? bannerPath
      : `${env.OSS_BASE_URL}/${bannerPath}`
    : videoPath
      ? `${env.OSS_BASE_URL}/${videoPath}?x-oss-process=video/snapshot,t_0,m_fast`
      : "";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="aspect-video overflow-hidden bg-muted">
        {coverUrl ? (
          <img src={coverUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground/30">
            {(title.slice(0, 1) || "?").toUpperCase()}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium">{title || tp("noData")}</div>
      </div>
    </div>
  );
}

// ─── Projects (IPs created by the creator) ───────────

function ProjectsSection({ creatorId }: { creatorId: string }) {
  const tp = useTranslations("profile");
  const { data, isLoading } = useCreatorProjects(creatorId);
  const projects = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        {tp("noData")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  // Click-through disabled for now — IP detail wiring will land later.
  const bannerUrl = project.bannerLink
    ? project.bannerLink.startsWith("http")
      ? project.bannerLink
      : `${env.BANNER_BASE_URL}/${project.bannerLink}`
    : "";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="aspect-4/3 overflow-hidden bg-muted">
        {bannerUrl ? (
          <img src={bannerUrl} alt={project.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground/30">
            {project.name.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium">{project.name}</div>
      </div>
    </div>
  );
}

// ─── Joined ───────────────────────────────────────────

function JoinedSection({ creatorId }: { creatorId: string }) {
  const tp = useTranslations("profile");
  const { data, isLoading } = useCreatorJoinedProjects(creatorId);
  const projects = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        {tp("noData")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
