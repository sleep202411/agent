"use client";

import Link from "next/link";
import { IconAlertTriangle, IconArrowLeft } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/src/i18n/config";
import { useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";

export function ExperienceLoadError({
  message,
  locale,
}: {
  message?: string | null;
  locale: Locale;
}) {
  const t = useTranslations("experiencePlayer");
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-black px-5 py-12 text-white">
      <section role="alert" className="w-full max-w-lg text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-red-500/12 text-red-400">
          <IconAlertTriangle className="size-5" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.02em]">{t("loadErrorTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-white/52">{t("loadErrorDescription")}</p>
        <pre className="mt-5 overflow-auto rounded-xl bg-white/[0.055] p-4 text-left font-mono text-xs leading-5 whitespace-pre-wrap text-white/68">
          {message ?? t("loadErrorUnknown")}
        </pre>
        <Button asChild variant="soft" className="mt-6 min-h-11 rounded-full px-5">
          <Link href={localizePath("/games", locale)}>
            <IconArrowLeft className="size-4" />
            {t("returnToGames")}
          </Link>
        </Button>
      </section>
    </main>
  );
}
