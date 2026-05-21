"use client";

/**
 * CrewsTab — crews this creator has joined (member or founder).
 * Reads `useCreatorJoinedProjects` for the by-id list. Renders a
 * compact card list — crew cards have the same visual treatment as
 * the IPs tab for consistency.
 */
import { IconLoader2, IconUsers } from "@tabler/icons-react";
import Link from "next/link";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { useCreatorJoinedProjects, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import type { Project } from "@/src/services/project";

interface CrewsTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function CrewsTab({ creator, isOwner }: CrewsTabProps) {
  const t = useTranslations("creatorCenter");
  const locale = useLocale() as Locale;
  const { data, isLoading } = useCreatorJoinedProjects(creator.id);
  const projects = (data ?? []).filter((p): p is Project => !!p);

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyShell
        title={isOwner ? t("crews.emptyOwnerTitle") : t("crews.emptyVisitorTitle")}
        body={isOwner ? t("crews.emptyOwnerBody") : t("crews.emptyVisitorBody")}
        cta={
          isOwner ? (
            <Link
              href={localizePath("/crews", locale)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary"
            >
              {t("crews.discoverCta")}
            </Link>
          ) : null
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {projects.map((p) => (
        <CrewCard key={p.id} project={p} locale={locale} />
      ))}
    </div>
  );
}

function CrewCard({ project, locale }: { project: Project; locale: Locale }) {
  const cover = resolveAsset(String(project.bannerLink ?? ""), env.BANNER_BASE_URL);
  const title = String(project.name ?? "").trim() || "—";
  // Joined projects link to the IP detail page; the crew workspace
  // requires owner/member workspace context which a public profile
  // visit isn't authorized for.
  const href = localizePath(`/ips/${project.id}`, locale);
  return (
    <Link
      href={href}
      className="group overflow-hidden rounded-xl bg-card transition-transform hover:-translate-y-0.5"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-secondary">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <IconUsers className="size-6" />
          </div>
        )}
      </div>
      <div className="px-3 py-2.5">
        <h3 className="line-clamp-1 text-sm font-medium text-foreground">{title}</h3>
      </div>
    </Link>
  );
}

function EmptyShell({ title, body, cta }: { title: string; body: string; cta: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card/40 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <IconUsers className="size-5" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      {cta}
    </div>
  );
}

function resolveAsset(path: string, base: string): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  if (!base) return "";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${trimmed}`;
}
