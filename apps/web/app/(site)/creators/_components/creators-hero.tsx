"use client";

import { IconBrandWechat, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
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
        {showQr && (
          <div className="absolute right-6 top-16">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("groupQrTitle")}
                  className="inline-flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-emerald-300 backdrop-blur-md transition-colors hover:border-emerald-300/40 hover:bg-emerald-300/10 hover:text-emerald-200"
                >
                  <IconBrandWechat className="size-5" />
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
          </div>
        )}

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

          <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="size-1.5 rounded-full bg-amber-400" />
            <strong className="text-foreground">{total}</strong>
            <span>{t("openCountSuffix")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
