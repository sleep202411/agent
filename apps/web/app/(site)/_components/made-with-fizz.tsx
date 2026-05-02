"use client";

/**
 * "Made with FizzDragon" — homepage content wall pulling the first 8
 * IPs via the homepage's local featured-ips fetcher. Skips rendering
 * entirely if the list is empty so the section doesn't ship with stub
 * data.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { IconArrowRight, IconSparkles } from "@tabler/icons-react";
import { fetchFeaturedIPs, ipBannerUrl, type FeaturedIP } from "../_services/featured-ips";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

export function MadeWithFizz() {
  const { data, isError, isLoading } = useQuery<FeaturedIP[]>({
    queryKey: ["home", "featured-ips"],
    queryFn: () => fetchFeaturedIPs(8),
  });
  const items = data ?? null;
  const locale = useLocale() as Locale;
  const t = useTranslations("home");

  // Don't render anything if the fetch fails or returns nothing — we
  // don't want a half-empty content wall to be the second thing visitors
  // see. Loading state shows a skeleton grid below.
  if (isError || (items !== null && items.length === 0)) return null;

  return (
    <section className="relative border-t border-border/40 px-6 py-32">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground">
              {t("madeWithFizz.eyebrow")}
            </div>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {t("madeWithFizz.title")}
            </h2>
            <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              {t("madeWithFizz.subtitle")}
            </p>
          </div>
          <Link
            href={localizePath("/ips", locale)}
            className="group inline-flex items-center gap-1.5 self-start rounded-full border border-border/50 bg-card/40 px-4 py-2 text-sm text-foreground/80 transition-colors hover:border-border hover:text-foreground sm:self-end"
          >
            {t("madeWithFizz.viewAll")}
            <IconArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {isLoading || items === null ? (
          <SkeletonGrid />
        ) : (
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, ease: "easeOut", delay: i * 0.05 }}
              >
                <Card
                  project={project}
                  locale={locale}
                  byOwnerLabel={t("madeWithFizz.byOwner", { name: project.ownerName ?? "" })}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Card({
  project,
  locale,
  byOwnerLabel,
}: {
  project: FeaturedIP;
  locale: Locale;
  byOwnerLabel: string;
}) {
  const cover = ipBannerUrl(project.bannerLink);
  return (
    <Link
      href={localizePath(`/ips/${project.id}`, locale)}
      className="group relative block overflow-hidden rounded-2xl border border-border/50 bg-card transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-lg hover:shadow-black/20"
    >
      <div className="relative aspect-[3/4] overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={project.name}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted">
            <IconSparkles className="size-8 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3">
          <div className="truncate text-base font-semibold text-white">{project.name}</div>
          {project.ownerName ? (
            <div className="mt-1 truncate text-xs text-white/70">{byOwnerLabel}</div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[3/4] animate-pulse overflow-hidden rounded-2xl border border-border/40 bg-card/40"
        />
      ))}
    </div>
  );
}
