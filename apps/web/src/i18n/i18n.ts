import { useCallback } from "react";
import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { defaultLocale, detectBrowserLocale, isValidLocale } from "./config";

import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": { translation: enUS },
    "zh-CN": { translation: zhCN },
    "zh-HK": { translation: zhHK },
  },
  lng: detectBrowserLocale(),
  fallbackLng: defaultLocale,
  interpolation: {
    escapeValue: false,
    prefix: "{",
    suffix: "}",
  },
  returnNull: false,
  showSupportNotice: false,
});

export default i18n;

/**
 * Drop-in replacement for next-intl's useTranslations("namespace").
 *
 * Usage (identical signature):
 *   const t = useTranslations("storyboard");
 *   t("title")                    → "storyboard.title"
 *   t("maxMaterials", { max: 10 })  → interpolation
 */
export function useTranslations(ns: string) {
  const { t } = useTranslation();
  return useCallback(
    (key: string, params?: Record<string, string | number | Date>) => {
      return t(`${ns}.${key}`, params as Record<string, unknown>) as string;
    },
    [t, ns]
  );
}

/**
 * Drop-in replacement for next-intl's useLocale().
 */
export function useLocale(): string {
  const { i18n: instance } = useTranslation();
  return instance.language;
}

/**
 * Set the active language. Call from locale switcher or when URL locale changes.
 */
export function setLanguage(lng: string): void {
  if (!isValidLocale(lng)) return;
  void i18n.changeLanguage(lng);
  if (typeof window !== "undefined") {
    localStorage.setItem("language", lng);
    document.documentElement.lang = lng;
  }
}
