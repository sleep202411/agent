"use client";

/**
 * "Made with FizzDragon" — homepage content wall of in-production IPs. Reuses
 * the IP Plaza hero placement (`ip_plaza_hero`) so the homepage and the /ips
 * hero are curated from the same source. Landscape cards. Renders nothing if
 * the placement is empty so the section never ships with stub data.
 */

import Link from "next/link";
import { motion } from "motion/react";
import { IconArrowRight, IconSparkles } from "@tabler/icons-react";
import { useIpCommerceDiscovery } from "@/src/lib/ip-commerce/hooks";
import type { IpCommerceAsset, IpCommerceDiscoveryItem } from "@/src/lib/ip-commerce/api";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

function assetUrl(asset: IpCommerceAsset | null | undefined) {
  return asset?.url || asset?.externalUrl || "";
}

export function MadeWithFizz() {
  const locale = useLocale() as Locale;
  const t = useTranslations("home");
  const { data, isError, isLoading } = useIpCommerceDiscovery({
    placementKey: "ip_plaza_hero",
    locale,
  });
  const items = data ? data.items : null;

  // Don't render a half-empty wall: bail on error / empty (loading → skeleton).
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
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, ease: "easeOut", delay: i * 0.05 }}
              >
                <Card item={item} locale={locale} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Card({ item, locale }: { item: IpCommerceDiscoveryItem; locale: Locale }) {
  // Placement banner if curated, else fall back to the IP's own cover (the
  // ip_plaza_hero items often have no dedicated banner image).
  const cover = assetUrl(item.image) || assetUrl(item.ipCard?.coverAsset);
  const title = item.title || item.ip?.title || "";
  return (
    <Link
      href={localizePath(`/ips/${item.ipId}`, locale)}
      className="group relative block overflow-hidden rounded-2xl border border-border/50 bg-card transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-lg hover:shadow-black/20"
    >
      <div className="relative aspect-video overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={title}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted">
            <IconSparkles className="size-8 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="absolute inset-x-3 bottom-3">
          {item.eyebrow ? (
            <div className="mb-1 text-[11px] font-medium tracking-wide text-white/70 uppercase">
              {item.eyebrow}
            </div>
          ) : null}
          <div className="truncate text-base font-semibold text-white">{title}</div>
        </div>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="aspect-video animate-pulse overflow-hidden rounded-2xl border border-border/40 bg-card/40"
        />
      ))}
    </div>
  );
}
