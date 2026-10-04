"use client";

/**
 * IpsTab — a creator's IP cards. Fully on the PG IP schema (no legacy Java
 * project endpoint): the owner sees all IPs they own (me/ips, all pages) with a
 * studio entry; visitors see the creator's public IPs (public per-creator
 * endpoint, all pages) linking to the public IP detail page.
 */
import { useState } from "react";
import { IconBook2, IconEdit, IconLoader2 } from "@tabler/icons-react";
import Link from "next/link";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import { NewIpCreateDialog } from "@/app/(site)/ip-studio/_components/new-ip-create-form";
import { ChannelBadge } from "@/components/channel-badge";
import type { IpCommerceIp, IpCreatorIp } from "@/src/lib/ip-commerce/api";
import { useAllMyIpCommerceIps, usePublicCreatorIps } from "@/src/lib/ip-commerce/hooks";

interface IpsTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function IpsTab({ creator, isOwner }: IpsTabProps) {
  const t = useTranslations("creatorCenter");
  const locale = useLocale() as Locale;
  // Fully on the PG IP schema — the legacy Java /project/user/projects endpoint
  // is no longer called. Owner view loads every IP you own (all pages, owner-
  // scoped me/ips); visitor view loads the creator's public IPs (all pages) from
  // the public per-creator endpoint.
  const myNewIps = useAllMyIpCommerceIps(isOwner, { locale });
  const visitorIps = usePublicCreatorIps(creator.id, !isOwner, { locale });
  const newIps = isOwner ? (myNewIps.data?.items ?? []) : [];
  const publicIps = isOwner ? [] : (visitorIps.data?.items ?? []);
  const [createOpen, setCreateOpen] = useState(false);

  if (myNewIps.isLoading || visitorIps.isLoading) {
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

  if (publicIps.length === 0 && newIps.length === 0) {
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
        {publicIps.map((ip) => (
          <PublicIpCard key={ip.id} ip={ip} locale={locale} />
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
        {ip.channelType ? (
          <ChannelBadge
            category={ip.channelType}
            className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-white/90 backdrop-blur-sm"
          />
        ) : null}
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

// Visitor-view card for a creator's PUBLIC IP. Links to the public IP detail
// page (NOT the owner-only studio) and carries no edit affordance.
function PublicIpCard({ ip, locale }: { ip: IpCommerceIp; locale: Locale }) {
  const title = ip.title.trim() || "—";
  const summary = ip.summary.trim();
  const cover = ip.coverAsset?.url ?? ip.coverAsset?.externalUrl ?? "";
  const href = localizePath(`/ips/${ip.id}`, locale);
  return (
    <Link
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-border/60 transition-all duration-300 hover:-translate-y-1 hover:ring-border hover:shadow-lg hover:shadow-black/20"
    >
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
        {ip.channelType ? (
          <ChannelBadge
            category={ip.channelType}
            className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-white/90 backdrop-blur-sm"
          />
        ) : null}
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
