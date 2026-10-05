"use client";
import { ChannelBadge } from "@/components/channel-badge";

import Link from "next/link";
import { useState } from "react";
import { IpHoverPreview } from "./ip-hover-preview";
import {
  IconBookmark,
  IconEye,
  IconHeart,
  IconPlayerPlay,
  IconSparkles,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { ipRoomPath } from "@/src/lib/ip-commerce/urls";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { regionLabel } from "@/src/lib/regions";
import { encodeUserId } from "@/src/lib/user-id-codec";
import { UserAvatar } from "@/components/user-avatar";
import { IpPublisherLogos } from "@/components/ip-commerce/ip-publisher-logos";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PlazaCoCreator, PlazaProject } from "./plaza-types";

export function IPPlazaCard({ project }: { project: PlazaProject }) {
  const [preview, setPreview] = useState(false);
  const t = useTranslations("ip");
  const locale = useLocale() as Locale;
  const cat = project.genres[0] ?? "";
  const regionName = regionLabel(project.region, locale);
  // The primary genre already shows as the image overlay (`cat`); drop it from
  // the badge row so single-genre IPs don't render the same label twice.
  const tags = project.tags.filter((tag) => tag !== cat).slice(0, 3);
  const coCreators = project.coCreators ?? [];
  const ipHref = localizePath(ipRoomPath(project.roomNumber), locale);

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl transition-all hover:bg-muted/90 hover:shadow-lg hover:shadow-black/20">
      <Link
        href={ipHref}
        onMouseEnter={() => setPreview(true)}
        onMouseLeave={() => setPreview(false)}
        onFocus={() => setPreview(true)}
        onBlur={() => setPreview(false)}
        className="relative aspect-video w-full overflow-hidden bg-secondary"
      >
        {project.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.cover}
            alt={project.name}
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105 rounded-2xl overflow-hidden"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <IconSparkles className="size-8 text-muted-foreground/20" />
          </div>
        )}

        <IpHoverPreview
          key={`${project.id}:${project.trailer}:${preview}`}
          src={project.trailer}
          active={preview}
        />
        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/15 to-transparent" />

        {regionName && (
          <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
            {regionName}
          </span>
        )}

        {project.trailer && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            <IconPlayerPlay className="size-3" />
            {t("trailer")}
          </span>
        )}

        <div className="absolute inset-x-3 bottom-2.5">
          <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white transition-colors group-hover:text-primary">
            {project.name}
          </h3>
          {cat && <div className="mt-0.5 text-[10px] font-medium text-white/60">{cat}</div>}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-4">
        <div className="flex h-7 items-center justify-between gap-2">
          <ChannelBadge category={project.channelType} />
          <PlazaCoCreatorAvatars people={coCreators} locale={locale} label={t("plazaCoCreators")} />
        </div>

        <Link href={ipHref} className="flex min-h-[4.5rem] flex-1 flex-col gap-3">
          {project.description ? (
            <p className="line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
              {project.description}
            </p>
          ) : (
            <p className="line-clamp-3 text-[13px] leading-relaxed text-transparent select-none">
              —
            </p>
          )}

          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </Link>

        <div className="mt-auto flex flex-col gap-3">
          <div className="flex h-5 items-center justify-end gap-3 text-xs text-muted-foreground">
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${t("detailViews")} ${formatEngagementCount(project.viewCount, locale)}`}
            >
              <IconEye className="size-3.5" />
              <span className="tabular-nums">
                {formatEngagementCount(project.viewCount, locale)}
              </span>
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${t("detailLike")} ${formatEngagementCount(project.likeCount, locale)}`}
            >
              <IconHeart className="size-3.5" />
              <span className="tabular-nums">
                {formatEngagementCount(project.likeCount, locale)}
              </span>
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${t("detailSave")} ${formatEngagementCount(project.collectionCount, locale)}`}
            >
              <IconBookmark className="size-3.5" />
              <span className="tabular-nums">
                {formatEngagementCount(project.collectionCount, locale)}
              </span>
            </span>
          </div>

          {/* Dedicated logo row — keeps wordmarks from competing with stats. */}
          <div className="flex h-5 items-center">
            <IpPublisherLogos publishers={project.publishers} size="md" className="min-w-0" />
          </div>
        </div>
      </div>
    </article>
  );
}

function PlazaCoCreatorAvatars({
  people,
  locale,
  label,
}: {
  people: PlazaCoCreator[];
  locale: Locale;
  label: string;
}) {
  if (people.length === 0) return <span className="h-6 w-0 shrink-0" aria-hidden />;

  return (
    <ul className="flex h-6 shrink-0 items-center -space-x-1.5" aria-label={label}>
      {people.slice(0, 3).map((person) => {
        const canLink = Boolean(person.userId?.trim());
        const href = canLink
          ? localizePath(`/creators/${encodeUserId(person.userId)}`, locale)
          : null;
        const avatar = (
          <UserAvatar
            seed={person.userId || person.id}
            name={person.displayName}
            className="size-6 ring-2 ring-background"
          />
        );
        return (
          <li key={person.id} className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                {href ? (
                  <Link
                    href={href}
                    aria-label={person.displayName}
                    className="relative inline-flex rounded-full transition hover:z-10 hover:ring-2 hover:ring-primary/40"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {avatar}
                  </Link>
                ) : (
                  <span className="inline-flex rounded-full" title={person.displayName}>
                    {avatar}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {person.displayName}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

function formatEngagementCount(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.max(0, value));
}

/** GPS uses verified display fields without fabricating catalogue engagement metrics. */
export function ContentGpsPlazaCard({
  item,
  selected,
  onSelect,
}: {
  item: import("@repo/shared/content-gps").ContentGpsSearchResult["items"][number];
  selected: boolean;
  onSelect: () => void;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("contentGpsDiscovery");
  const href = localizePath(ipRoomPath(item.roomNumber), locale);
  return (
    <article
      className={`group flex h-full min-w-0 flex-col gap-3 rounded-2xl p-2 ${selected ? "bg-muted ring-2 ring-primary" : "hover:bg-muted/50"}`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={t("selectTitle", { title: item.title })}
        className="relative aspect-video w-full overflow-hidden rounded-xl bg-secondary focus-visible:outline-2 focus-visible:outline-primary"
      >
        {item.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <IconSparkles className="mx-auto size-8 text-muted-foreground" />
        )}
        {selected && (
          <span className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-1 text-xs">
            ◆ {t("selected")}
          </span>
        )}
      </button>
      <Link href={href} className="line-clamp-2 text-sm font-semibold hover:underline">
        {item.title}
      </Link>
      {item.summary && (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{item.summary}</p>
      )}
      <p className="mt-auto text-xs text-muted-foreground">
        {item.locations.map((location) => location.label).join(" · ") || t("unknownLocation")}
      </p>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="min-h-11 text-left text-sm hover:underline"
      >
        {t("viewMatch")}
      </button>
    </article>
  );
}
