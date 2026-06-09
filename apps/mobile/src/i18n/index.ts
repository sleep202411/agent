import { useSyncExternalStore } from "react";

import type { AppLocale } from "@/config";

import { getLocale, subscribeLocale } from "./locale-store";
import enUS from "./messages/en-US.json";
import zhCN from "./messages/zh-CN.json";
import zhHK from "./messages/zh-HK.json";

export type MessageKey = keyof typeof enUS;

const catalogs = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "zh-HK": zhHK,
} satisfies Record<AppLocale, Record<MessageKey, string>>;

/** Pure lookup with English fallback, then the raw key. */
export function translate(locale: AppLocale, key: MessageKey): string {
  return catalogs[locale]?.[key] ?? enUS[key] ?? key;
}

/**
 * Non-reactive lookup against the current locale. Use only outside React
 * (constants, helpers). Inside components prefer `useTranslations` so the UI
 * re-renders when the language changes.
 */
export function t(key: MessageKey): string {
  return translate(getLocale(), key);
}

/** Reactive translator — re-renders the component when the locale changes. */
export function useTranslations(): (key: MessageKey) => string {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return (key: MessageKey) => translate(locale, key);
}

/** Reactive current locale. */
export function useLocale(): AppLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export { SUPPORTED_LOCALES, setLocale, initLocale } from "./locale-store";
