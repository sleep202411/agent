"use client";

import Link from "next/link";
import { IconArrowRight, IconBrandWechat, IconSparkles, IconUserCircle } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface CreatorsHeroProps {
  total: number;
}

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

export function CreatorsHero({ total }: CreatorsHeroProps) {
  const t = useTranslations("creator");
  const locale = useLocale() as Locale;
  const showQr = isQrActive();

  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 50% 50% at 20% 30%, hsl(42 95% 55% / 0.08) 0%, transparent 60%), radial-gradient(ellipse 40% 40% at 80% 60%, hsl(280 60% 55% / 0.06) 0%, transparent 60%)",
        }}
      />

      <div className="relative mx-auto max-w-screen-2xl px-6 pb-12 pt-16">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400">
            <IconSparkles className="size-4" />
            {t("plaza")}
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{t("eyebrowMeta")}</span>
          </div>

          <h1 className="mt-4 text-4xl font-black leading-[1.1] tracking-tight text-foreground md:text-5xl">
            {t("heroTitle")}
            <br />
            <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
              {t("heroTitleAccent")}
            </span>
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
            {t("heroSubtitle")}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-amber-400" />
              <strong className="text-foreground">{total}</strong>
              <span>{t("openCountSuffix")}</span>
            </div>
            <span className="text-xs text-muted-foreground/70">{t("openCountCap")}</span>
          </div>
        </div>

        {/* Right-side CTA stack — Creator Community pill on top, then
         *  Complete-profile CTA. md+ floats absolute at the hero's
         *  bottom-right; below md it falls back to inline flow at the
         *  end of the hero so it doesn't fight the headline for
         *  horizontal space. Both buttons stay vertically stacked at
         *  all sizes. */}
        <div className="mt-8 flex flex-col items-stretch gap-3 md:absolute md:right-6 md:bottom-12 md:mt-0 md:items-end">
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
        </div>
      </div>
    </section>
  );
}
