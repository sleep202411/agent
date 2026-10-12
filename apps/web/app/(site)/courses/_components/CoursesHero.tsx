"use client";

import { useTranslations } from "@/src/i18n/i18n";

export function CoursesHero() {
  const t = useTranslations("courses");

  return (
    <section>
      <p className="flex flex-wrap items-center gap-x-3 text-[10px] font-semibold tracking-[0.32em] text-white/45 uppercase">
        <span className="text-[#ea2804]">{t("heroEyebrow")}</span>
        <span>{t("heroMeta")}</span>
      </p>
      <h1 className="font-heading mt-2.5 text-[1.85rem] leading-[1.08] font-extrabold tracking-tight text-white md:text-[2.75rem]">
        {t("heroTitle")}
        <span className="tracking-[-0.04em] text-[#ea2804]">{t("heroTitleAccent")}</span>
        <span className="block">{t("heroTitleLine2")}</span>
      </h1>
      <p className="mt-3 max-w-[460px] text-[13px] leading-5 text-white/50">
        {t("heroDescription")}
      </p>
    </section>
  );
}
