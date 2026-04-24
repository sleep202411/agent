"use client";

import { useTranslations } from "@/src/i18n/i18n";
import pkg from "../../../package.json";

/**
 * /about — minimal About page, ported from legacy mine/setting/about.vue.
 *
 * Legacy showed just three things: the app logo, a "版本 v1.0.1" line,
 * and a single-sentence tagline. Next.js version keeps the same shape
 * but pulls the version from package.json so it stays in sync
 * automatically on every release build.
 */
export default function AboutPage() {
  const t = useTranslations("about");
  return (
    <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-4">
          <img
            src="https://static.fizzspace.cn/static/pc/logo.png"
            alt="FizzDragon Studio"
            className="h-16 object-contain"
          />
          <span className="text-sm text-muted-foreground">
            {t("version", { version: pkg.version })}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("tagline")}</p>
      </div>
    </div>
  );
}
