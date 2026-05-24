"use client";

/**
 * IpsTab — IP (project) cards the creator owns. Maps the existing
 * `useCreatorProjects` hook into a grid layout that matches the
 * style of WorksTab and ServicesTab.
 */
import { IconBook2, IconEdit, IconLoader2 } from "@tabler/icons-react";
import Link from "next/link";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { useCreatorProjects, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import type { Project } from "@/src/services/project";

interface IpsTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function IpsTab({ creator, isOwner }: IpsTabProps) {
  const t = useTranslations("creatorCenter");
  const locale = useLocale() as Locale;
  const { data, isLoading } = useCreatorProjects(creator.id);
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
        title={isOwner ? t("ips.emptyOwnerTitle") : t("ips.emptyVisitorTitle")}
        body={isOwner ? t("ips.emptyOwnerBody") : t("ips.emptyVisitorBody")}
        cta={
          isOwner ? (
            <Link
              href={localizePath("/ips/create", locale)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary"
            >
              {t("ips.createCta")}
            </Link>
          ) : null
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((p) => (
        <IpCard
          key={p.id}
          project={p}
          locale={locale}
          isOwner={isOwner}
          editLabel={t("ips.editIp")}
        />
      ))}
    </div>
  );
}

function IpCard({
  project,
  locale,
  isOwner,
  editLabel,
}: {
  project: Project;
  locale: Locale;
  isOwner: boolean;
  editLabel: string;
}) {
  const cover = resolveAsset(String(project.bannerLink ?? ""), env.BANNER_BASE_URL);
  const title = String(project.name ?? "").trim() || "—";
  const description = String(project.description ?? "").trim();
  const href = localizePath(`/ips/${project.id}`, locale);
  const editHref = localizePath(`/ips/${project.id}/edit`, locale);
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-card ring-1 ring-border/60 transition-all duration-300 hover:-translate-y-1 hover:ring-border hover:shadow-lg hover:shadow-black/20">
      <Link href={href} className="block">
        {/* 16:9 cover. Gradient overlay at the bottom keeps the title
            readable even when the artwork bleeds bright into the lower
            third. `object-cover` lets the artwork breathe past the
            edges on hover for a subtle parallax-ish lift. */}
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={title}
              loading="lazy"
              className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-gradient-to-br from-secondary to-background text-muted-foreground/60">
              <IconBook2 className="size-8" />
            </div>
          )}
          {/* Bottom gradient so the title chip below sits on a soft
              shadow rather than competing with cover brightness. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
        </div>
        <div className="space-y-1 px-4 py-3">
          <h3 className="line-clamp-1 text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="line-clamp-1 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </Link>
      {isOwner && (
        <Link
          href={editHref}
          className="absolute right-2.5 top-2.5 inline-flex size-8 items-center justify-center rounded-lg bg-background/85 text-foreground opacity-0 shadow-sm ring-1 ring-border backdrop-blur-sm transition-all duration-200 group-hover:opacity-100 hover:bg-background hover:scale-105 focus-visible:opacity-100"
          aria-label={editLabel}
          onClick={(e) => e.stopPropagation()}
        >
          <IconEdit className="size-4" />
        </Link>
      )}
    </div>
  );
}

function EmptyShell({ title, body, cta }: { title: string; body: string; cta: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card/40 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <IconBook2 className="size-5" />
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
