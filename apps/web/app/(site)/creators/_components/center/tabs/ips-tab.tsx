"use client";

/**
 * IpsTab — IP (project) cards the creator owns. Maps the existing
 * `useCreatorProjects` hook into a grid layout that matches the
 * style of WorksTab and ServicesTab.
 */
import { IconBook2, IconLoader2 } from "@tabler/icons-react";
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
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {projects.map((p) => (
        <IpCard key={p.id} project={p} locale={locale} />
      ))}
    </div>
  );
}

function IpCard({ project, locale }: { project: Project; locale: Locale }) {
  const cover = resolveAsset(String(project.bannerLink ?? ""), env.BANNER_BASE_URL);
  const title = String(project.name ?? "").trim() || "—";
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
            <IconBook2 className="size-6" />
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
