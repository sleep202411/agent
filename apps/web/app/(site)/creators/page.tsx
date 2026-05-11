"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  IconArrowRight,
  IconBrandWechat,
  IconLoader2,
  IconSparkles,
  IconUserCircle,
} from "@tabler/icons-react";
import { useCreators } from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorsTalentGrid } from "@/app/(site)/creators/_components/creators-talent-grid";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PlazaHero } from "@/components/layout/plaza-hero";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

/**
 * Group QR card visible until `WECHAT_GROUP_EXPIRES_AT`. Drop the latest
 * QR PNG at `public/wechat-group.png` (current 7-day token, replaced
 * weekly during the recruiting push) and bump the expiry date here.
 * After the date passes the card hides itself — no stale invite shown.
 */
const WECHAT_GROUP_QR_SRC = "/wechat-group.png";
const WECHAT_GROUP_EXPIRES_AT = "2026-05-05";

function isQrActive(now: Date = new Date()): boolean {
  const expiry = new Date(`${WECHAT_GROUP_EXPIRES_AT}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) return false;
  return now <= expiry;
}

export default function CreatorsPage() {
  const t = useTranslations("creator");
  const locale = useLocale() as Locale;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useCreators();
  const creators = data?.list ?? [];
  const total = data?.total ?? creators.length;
  const showQr = isQrActive();

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "320px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div className="min-h-screen bg-background">
      <PlazaHero
        eyebrow={{ icon: IconSparkles, label: t("plaza"), meta: t("eyebrowMeta") }}
        title={{ plain: t("heroTitle"), accent: t("heroTitleAccent") }}
        subtitle={t("heroSubtitle")}
        stats={{
          items: [{ value: total, label: t("openCountSuffix") }],
          cap: t("openCountCap"),
          dotted: true,
        }}
        rightSlot={
          <>
            {showQr && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("groupQrTitle")}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-medium text-emerald-300 backdrop-blur-md transition-colors hover:border-emerald-300/40 hover:bg-emerald-300/10 hover:text-emerald-200"
                  >
                    <IconBrandWechat className="size-5" />
                    <span>{t("creatorCommunity")}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 gap-3 p-4">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                    <IconBrandWechat className="size-3.5" />
                    {t("groupQrEyebrow")}
                  </div>
                  <div className="overflow-hidden rounded-lg bg-white">
                    <img
                      src={WECHAT_GROUP_QR_SRC}
                      alt={t("groupQrAlt")}
                      className="block aspect-square w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <p className="text-center text-xs font-medium text-foreground">
                    {t("groupQrTitle")}
                  </p>
                  <p className="-mt-2 text-center text-[10px] text-muted-foreground">
                    {t("groupQrExpiry", { date: WECHAT_GROUP_EXPIRES_AT })}
                  </p>
                </PopoverContent>
              </Popover>
            )}

            <Link
              href={localizePath("/profile", locale)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/5 px-4 py-2 text-sm font-medium text-amber-300 backdrop-blur-md transition-colors hover:border-amber-300/50 hover:bg-amber-400/10 hover:text-amber-200"
            >
              <IconUserCircle className="size-4" />
              <span>{t("completeProfileCta")}</span>
              <IconArrowRight className="size-3.5" />
            </Link>
          </>
        }
      />
      <CreatorsTalentGrid creators={creators} isLoading={isLoading} />
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
        </div>
      )}
    </div>
  );
}
