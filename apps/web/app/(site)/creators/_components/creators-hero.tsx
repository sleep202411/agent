"use client";

import { IconBrandWechat, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

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

      <div className="relative mx-auto grid max-w-screen-2xl gap-8 px-6 pb-12 pt-16 md:grid-cols-[1fr_auto] md:items-center">
        <div>
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

        {showQr && (
          <aside className="hidden w-70 shrink-0 rounded-2xl border border-white/10 bg-white/4 p-5 backdrop-blur-md md:block">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
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
            <p className="mt-3 text-center text-xs font-medium text-foreground">
              {t("groupQrTitle")}
            </p>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">
              {t("groupQrExpiry", { date: WECHAT_GROUP_EXPIRES_AT })}
            </p>
          </aside>
        )}
      </div>
    </section>
  );
}
