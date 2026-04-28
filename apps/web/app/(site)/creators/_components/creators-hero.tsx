"use client";

import { IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

interface CreatorsHeroProps {
  total: number;
}

export function CreatorsHero({ total }: CreatorsHeroProps) {
  const t = useTranslations("creator");

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
    </section>
  );
}
