"use client";

import Image from "next/image";
import Link from "next/link";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBook2,
  IconPlayerPlay,
  IconSparkles,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { NARRATIVE_PLAYABLES } from "@/src/features/narrative/narrative-games";

export default function GamesPage() {
  const locale = useLocale() as Locale;
  const t = useTranslations("games");

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6">
        <Button asChild variant="ghost" color="muted" className="text-muted-foreground">
          <Link href={localizePath("/ips", locale)}>
            <IconArrowLeft className="size-4" />
            {t("back")}
          </Link>
        </Button>

        <section className="mt-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <IconSparkles className="size-3.5" />
            {t("eyebrow")}
          </div>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{t("subtitle")}</p>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          {/* Dream of Jinling — first-person interactive film */}
          <article className="group overflow-hidden rounded-2xl bg-secondary/55 transition-colors hover:bg-secondary/70">
            <div className="relative aspect-video overflow-hidden bg-[linear-gradient(155deg,#101b20_0%,#070b0d_48%,#020304_100%)]">
              <div className="absolute inset-x-[24%] bottom-[14%] top-[23%] rotate-[-4deg] border border-[#d6c5a0]/25 bg-[#b9a77f]/15 shadow-[0_24px_70px_rgba(0,0,0,0.7)] transition-transform duration-700 group-hover:rotate-[-2deg] group-hover:scale-[1.02]">
                <div className="absolute inset-x-[12%] top-[22%] h-px bg-[#e3d4b4]/18" />
                <div className="absolute inset-x-[12%] top-[38%] h-px bg-[#e3d4b4]/12" />
                <div className="absolute bottom-[17%] right-[12%] grid size-9 place-items-center border border-[#a93438]/55 text-[#bd4b4e]">
                  <IconBook2 className="size-4" stroke={1.25} />
                </div>
              </div>
              <div className="absolute inset-0 bg-linear-to-b from-black/5 via-transparent to-black/82" />
              <div className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white/90">
                {t("status.inProduction")}
              </div>
              <div className="absolute bottom-4 left-4 right-4">
                <p className="text-sm font-semibold text-white/60">
                  {t("items.jinlingRumeng.type")}
                </p>
                <h2 className="mt-1 text-2xl font-semibold leading-tight text-white">
                  {t("items.jinlingRumeng.title")}
                </h2>
              </div>
            </div>
            <div className="p-5">
              <p className="text-sm leading-6 text-muted-foreground">
                {t("items.jinlingRumeng.summary")}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(["interactiveCinema", "originalPlayer", "firstPerson"] as const).map((tagKey) => (
                  <span
                    key={tagKey}
                    className="rounded-full bg-background/65 px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                  >
                    {t(`tags.${tagKey}`)}
                  </span>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {(["scenes10", "endings5", "localSession"] as const).map((statKey) => (
                  <div key={statKey} className="rounded-xl bg-background/55 px-3 py-2">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {t(`stats.${statKey}`)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex justify-end">
                <Link
                  href={localizePath("/play/jinling", locale)}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
                >
                  <IconPlayerPlay className="size-4" />
                  {t("openLedger")}
                </Link>
              </div>
            </div>
          </article>

          {NARRATIVE_PLAYABLES.map((playable) => {
            const itemKey = `items.${playable.translationKey}`;
            return (
              <article
                key={playable.id}
                className="group overflow-hidden rounded-2xl bg-secondary/55 transition-colors hover:bg-secondary/70"
              >
                <div className="relative aspect-video overflow-hidden bg-black">
                  <Image
                    src={playable.coverSrc}
                    alt={t(`${itemKey}.coverAlt`)}
                    fill
                    unoptimized
                    sizes="(min-width: 768px) 50vw, 100vw"
                    className="object-cover opacity-78 transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-linear-to-b from-black/10 via-black/20 to-black/70" />
                  <div className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white/90">
                    {t(`status.${playable.status}`)}
                  </div>
                  <div className="absolute bottom-4 left-4 right-4">
                    <p className="text-sm font-semibold text-white/60">{t(`${itemKey}.type`)}</p>
                    <h2 className="mt-1 text-2xl font-semibold leading-tight text-white">
                      {t(`${itemKey}.title`)}
                    </h2>
                  </div>
                </div>

                <div className="p-5">
                  <p className="text-sm leading-6 text-muted-foreground">
                    {t(`${itemKey}.summary`)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {playable.tagKeys.map((tagKey) => (
                      <span
                        key={tagKey}
                        className="rounded-full bg-background/65 px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                      >
                        {t(`tags.${tagKey}`)}
                      </span>
                    ))}
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    {playable.statKeys.map((statKey) => (
                      <div key={statKey} className="rounded-xl bg-background/55 px-3 py-2">
                        <p className="text-xs font-semibold text-muted-foreground">
                          {t(`stats.${statKey}`)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <Link
                      href={localizePath(`/ips/${playable.sourceIpId}`, locale)}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t("sourceIp")}
                      <IconArrowRight className="size-4" />
                    </Link>
                    <Link
                      href={localizePath(playable.href, locale)}
                      className={cn(
                        "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground",
                        "transition-transform hover:-translate-y-0.5 active:translate-y-0"
                      )}
                    >
                      <IconPlayerPlay className="size-4" />
                      {t("start")}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
