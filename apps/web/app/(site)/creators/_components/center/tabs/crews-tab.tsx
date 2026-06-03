"use client";

/**
 * CrewsTab — crews this creator founded or belongs to. Fully on the Nest
 * crew system (`/aurora/crews`): the owner sees all their crews (founded +
 * joined, incl. unlisted) via `/crews/my`; visitors see the creator's public
 * (listed) crews via the public per-user endpoint. Cards link to the crew
 * page. The legacy Java `/project/user/joined` endpoint is no longer used.
 */
import { IconLoader2, IconUsers } from "@tabler/icons-react";
import Link from "next/link";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import { useMyCrews, usePublicCreatorCrews } from "@/app/(site)/crews/_hooks/use-crew-list";
import type { CrewDTO } from "@/app/(site)/crews/_hooks/types";

interface CrewsTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function CrewsTab({ creator, isOwner }: CrewsTabProps) {
  const t = useTranslations("creatorCenter");
  const locale = useLocale() as Locale;

  // Owner: every crew you're in (founded + joined, incl. unlisted) via
  // /crews/my. Visitor: the creator's public (listed) crews via the public
  // per-user endpoint. Only the active query runs (the other is disabled).
  const myCrews = useMyCrews(isOwner);
  const visitorCrews = usePublicCreatorCrews(creator.id, !isOwner);

  const crews: CrewDTO[] = isOwner
    ? [...(myCrews.data?.founded ?? []), ...(myCrews.data?.joined ?? [])]
    : (visitorCrews.data?.items ?? []);

  const active = isOwner ? myCrews : visitorCrews;

  if (active.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Surface failures instead of silently showing the empty state — the old
  // (legacy-endpoint) path made a dead/erroring API look like "no crews".
  if (active.isError && crews.length === 0) {
    return (
      <EmptyShell
        title={t("crews.loadFailedTitle")}
        body={t("crews.loadFailedBody")}
        cta={
          <button
            type="button"
            onClick={() => void active.refetch()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary"
          >
            {t("crews.retry")}
          </button>
        }
      />
    );
  }

  if (crews.length === 0) {
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
      {crews.map((crew) => (
        <CrewCard key={crew.id} crew={crew} locale={locale} />
      ))}
    </div>
  );
}

function CrewCard({ crew, locale }: { crew: CrewDTO; locale: Locale }) {
  const t = useTranslations("creatorCenter");
  const cover = resolveAsset(String(crew.logo ?? ""), env.BANNER_BASE_URL);
  const title = String(crew.name ?? "").trim() || "—";
  const href = localizePath(`/crews/${crew.id}`, locale);
  return (
    <Link
      href={href}
      className="group overflow-hidden rounded-xl bg-card transition-transform hover:-translate-y-0.5"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-secondary">
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
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("crews.memberCount", { count: crew.memberCount ?? 0 })}
        </p>
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
