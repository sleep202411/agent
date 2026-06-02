"use client";

/**
 * IpsTab — IP (project) cards the creator owns. Maps the existing
 * `useCreatorProjects` hook into a grid layout that matches the
 * style of WorksTab and ServicesTab.
 */
import { useState } from "react";
import {
  IconBook2,
  IconCoin,
  IconEdit,
  IconLoader2,
  IconLock,
  IconWallet,
} from "@tabler/icons-react";
import Link from "next/link";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { useCreatorProjects, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import type { Project } from "@/src/services/project";
import { NewIpCreateDialog } from "@/app/(site)/ip-studio/_components/new-ip-create-form";
import type { IpCreatorIp, IpCreatorRevenueEntry } from "@/src/lib/ip-commerce/api";
import { useCreatorRevenue, useMyIpCommerceIps } from "@/src/lib/ip-commerce/hooks";

interface IpsTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function IpsTab({ creator, isOwner }: IpsTabProps) {
  const t = useTranslations("creatorCenter");
  const locale = useLocale() as Locale;
  const { data, isLoading } = useCreatorProjects(creator.id);
  const myNewIps = useMyIpCommerceIps(isOwner, { locale, limit: 50 });
  const projects = (data ?? []).filter((p): p is Project => !!p);
  const newIps = isOwner ? (myNewIps.data?.items ?? []) : [];
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading || myNewIps.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOwner && myNewIps.isError && newIps.length === 0) {
    return (
      <>
        <EmptyShell
          title={t("ips.loadFailedTitle")}
          body={t("ips.loadFailedBody")}
          cta={
            <button
              type="button"
              onClick={() => void myNewIps.refetch()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary"
            >
              {t("ips.retry")}
            </button>
          }
        />
        <NewIpCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  if (projects.length === 0 && newIps.length === 0) {
    return (
      <>
        <EmptyShell
          title={isOwner ? t("ips.emptyOwnerTitle") : t("ips.emptyVisitorTitle")}
          body={isOwner ? t("ips.emptyOwnerBody") : t("ips.emptyVisitorBody")}
          cta={
            isOwner ? (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary"
              >
                {t("ips.createCta")}
              </button>
            ) : null
          }
        />
        <NewIpCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  return (
    <>
      {isOwner ? <CreatorEarningsCard locale={locale} /> : null}
      {isOwner ? (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary"
          >
            {t("ips.createCta")}
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {newIps.map((ip) => (
          <NewIpCard key={ip.id} ip={ip} locale={locale} enterLabel={t("ips.enterStudio")} />
        ))}
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
      <NewIpCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function NewIpCard({
  ip,
  locale,
  enterLabel,
}: {
  ip: IpCreatorIp;
  locale: Locale;
  enterLabel: string;
}) {
  const title = ip.title.trim() || "—";
  const summary = ip.summary.trim();
  const cover = ip.coverAsset?.url ?? ip.coverAsset?.externalUrl ?? "";
  const href = localizePath(`/ip-studio/${ip.id}`, locale);

  return (
    <Link
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-border/60 transition-all duration-300 hover:-translate-y-1 hover:ring-border hover:shadow-lg hover:shadow-black/20"
    >
      {/* 16:9 cover — real artwork when present, otherwise a neutral placeholder. */}
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
        {ip.genres[0] ? (
          <span className="absolute right-2 top-2 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm">
            {ip.genres[0]}
          </span>
        ) : null}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
      </div>

      <div className="flex flex-1 flex-col gap-1 px-4 py-3">
        <h3 className="line-clamp-1 text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        {summary ? (
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{summary}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
        <span className="text-xs text-muted-foreground">{enterLabel}</span>
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-background/85 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition group-hover:scale-105">
          <IconEdit className="size-4" />
        </span>
      </div>
    </Link>
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
  const editHref = localizePath(`/ip-studio/${project.id}`, locale);
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

function CreatorEarningsCard({ locale }: { locale: Locale }) {
  const t = useTranslations("creatorCenter");
  const { data, isLoading, isError } = useCreatorRevenue(true, { locale, limit: 6 });
  const entries = data?.entries ?? [];

  return (
    <div className="mb-4 rounded-2xl bg-card p-5 ring-1 ring-border/60">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#e52227]/12 text-[#e52227]">
            <IconWallet className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("earnings.title")}</h3>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              {t("earnings.shareNote")}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled
          aria-disabled
          className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 text-sm font-medium text-muted-foreground"
        >
          <IconLock className="size-3.5" />
          {t("earnings.cashOutComingSoon")}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconCoin className="size-3.5" />
            {t("earnings.withdrawableRevenue")}
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {isLoading ? "—" : formatPoints(data?.withdrawableBalance ?? "0", locale)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-xs text-muted-foreground">{t("earnings.lifetimeEarned")}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {isLoading ? "—" : formatPoints(data?.lifetimeEarned ?? "0", locale)}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold text-foreground">{t("earnings.revenueHistory")}</p>
        {isLoading ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <IconLoader2 className="size-4 animate-spin" />
            {t("earnings.loading")}
          </div>
        ) : isError ? (
          <p className="mt-3 text-xs text-muted-foreground">{t("earnings.loadFailed")}</p>
        ) : entries.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">{t("earnings.noRevenueYet")}</p>
        ) : (
          <div className="mt-3 divide-y divide-border/70">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="grid gap-2 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_110px_110px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {entry.ip?.title ?? t("earnings.unknownIp")}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[
                      entry.orderNo,
                      formatDateTime(entry.createdAt, locale),
                      salePctLabel(entry, t),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  {t(`earnings.entryStatus.${entry.status}`)}
                </p>
                <p className="font-medium tabular-nums text-foreground sm:text-right">
                  {formatPoints(entry.amount, locale)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// True fraction of THIS sale the creator earned = amount / sourceAmount.
// (entry.poolShareBps is only the beneficiary's share of the creator pool, so
// it cannot be shown as a sale percentage.)
function salePctLabel(
  entry: IpCreatorRevenueEntry,
  t: (key: string, values?: Record<string, string | number>) => string
): string | null {
  if (!entry.sourceAmount) return null;
  const source = Number(entry.sourceAmount);
  if (!Number.isFinite(source) || source <= 0) return null;
  const pct = Math.round((Number(entry.amount) / source) * 100);
  return t("earnings.percentOfSale", { pct });
}

function formatPoints(value: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale).format(Number(BigInt(value)));
  } catch {
    return value;
  }
}

function formatDateTime(value: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function resolveAsset(path: string, base: string): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  if (!base) return "";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${trimmed}`;
}
