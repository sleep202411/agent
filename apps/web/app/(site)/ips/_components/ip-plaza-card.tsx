"use client";

import Link from "next/link";
import {
  IconBookmark,
  IconEye,
  IconHeart,
  IconPlayerPlay,
  IconSparkles,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { regionLabel } from "@/src/lib/regions";
import type { PlazaProject } from "./plaza-types";

export function IPPlazaCard({ project }: { project: PlazaProject }) {
  const t = useTranslations("ip");
  const locale = useLocale() as Locale;
  const cat = project.genres[0] ?? "";
  const regionName = regionLabel(project.region, locale);
  // The primary genre already shows as the image overlay (`cat`); drop it from
  // the badge row so single-genre IPs don't render the same label twice.
  const tags = project.tags.filter((tag) => tag !== cat).slice(0, 3);

  return (
    <Link
      href={localizePath(`/ips/${project.id}`, locale)}
      className="group flex h-full flex-col overflow-hidden rounded-2xl hover:bg-muted/90 transition-all hover:shadow-lg hover:shadow-black/20"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-secondary">
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
      </div>

      <div className="flex-1 space-y-3.5 p-4">
        {project.description && (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        )}

        {tags.length > 0 && (
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
        )}

        <div className="flex items-center justify-end text-xs">
          <div className="flex shrink-0 items-center gap-3 text-muted-foreground">
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
        </div>
      </div>
    </Link>
  );
}

function formatEngagementCount(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.max(0, value));
}
