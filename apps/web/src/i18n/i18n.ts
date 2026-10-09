import { useCallback } from "react";
import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import {
  defaultLocale,
  detectBrowserLocale,
  isSiteLocale,
  isValidLocale,
  type Locale,
} from "./config";

import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";

type LocalizedMessageShape<T> = T extends string
  ? string
  : { [Key in keyof T]: LocalizedMessageShape<T[Key]> };

type UnifiedStoryMessageNamespaces = {
  experiencePlayer: LocalizedMessageShape<typeof enUS.experiencePlayer>;
  games: LocalizedMessageShape<typeof enUS.games>;
};

const resources = {
  "en-US": { translation: enUS },
  "zh-CN": { translation: zhCN },
  "zh-HK": { translation: zhHK },
} satisfies Record<
  Locale,
  {
    translation: Record<string, unknown> & UnifiedStoryMessageNamespaces;
  }
>;

// Message JSON modules hot-reload, but i18next keeps the first init payload.
// Re-apply bundles on every evaluation so new keys appear without a full restart.
function syncI18nResources() {
  (Object.keys(resources) as Locale[]).forEach((lng) => {
    i18n.addResourceBundle(lng, "translation", resources[lng].translation, true, true);
  });
}

if (i18n.isInitialized) {
  syncI18nResources();
} else {
  void i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: detectBrowserLocale(),
      fallbackLng: defaultLocale,
      interpolation: {
        escapeValue: false,
        prefix: "{",
        suffix: "}",
      },
      returnNull: false,
      showSupportNotice: false,
    })
    .then(syncI18nResources);
}

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
 *
 * Persists in two places:
 *   - localStorage["language"] — used by client-side detect helpers.
 *   - NEXT_LOCALE cookie — read by `proxy.ts` so unprefixed paths
 *     (e.g. when a stray `router.push("/foo")` slips through without
 *     localizePath) redirect to the user's last-chosen locale instead
 *     of always falling back to the default. Host-only cookie on
 *     purpose — same lesson as the satoken Domain bug: leaving Domain
 *     unset makes the cookie travel with the browser cleanly without
 *     surprising cross-subdomain leaks.
 */
const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function setLanguage(lng: string): void {
  // Reject locales the current cell does not offer (e.g. en-US on CN).
  if (!isValidLocale(lng) || !isSiteLocale(lng)) return;
  void i18n.changeLanguage(lng);
  if (typeof window !== "undefined") {
    localStorage.setItem("language", lng);
    document.documentElement.lang = lng;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(lng)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }
}
