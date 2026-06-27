import * as Localization from "expo-localization";

import { appEnv, type AppLocale } from "@/config";
import { getStoredString, setStoredString } from "@/lib/persistent-storage";

/**
 * Reactive locale store — mirrors the auth store pattern (external store +
 * useSyncExternalStore). The initial locale follows the device language
 * (synchronous, so first paint is correct); a user override persisted through
 * the app storage adapter takes over once `initLocale` resolves.
 */
export const SUPPORTED_LOCALES: AppLocale[] = ["en-US", "zh-CN", "zh-HK"];
const STORAGE_KEY = "fizzdragon.locale.override";

// Region default: global → en-US, CN → zh-CN. Used when the device language
// isn't one we localize into, so the CN build opens in Chinese (not English).
const DEFAULT_LOCALE: AppLocale = appEnv.defaultLocale;

/** Map any BCP-47 device tag to one of our supported locales. */
function mapToSupported(tag: string | null | undefined): AppLocale {
  if (!tag) return DEFAULT_LOCALE;
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) {
    // Traditional Chinese (Hant / HK / TW / MO) → zh-HK, otherwise Simplified.
    return /hant|hk|tw|mo/.test(lower) ? "zh-HK" : "zh-CN";
  }
  if (lower.startsWith("en")) return "en-US";
  // Any other device language falls back to the region default.
  return DEFAULT_LOCALE;
}

function detectDeviceLocale(): AppLocale {
  try {
    const locales = Localization.getLocales();
    return mapToSupported(locales?.[0]?.languageTag);
  } catch {
    return DEFAULT_LOCALE;
  }
}

let currentLocale: AppLocale = detectDeviceLocale();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getLocale(): AppLocale {
  return currentLocale;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Change the active locale and persist it as the user's override. */
export function setLocale(locale: AppLocale): void {
  if (!SUPPORTED_LOCALES.includes(locale) || locale === currentLocale) return;
  currentLocale = locale;
  notify();
  void setStoredString(STORAGE_KEY, locale).catch(() => {});
}

/** Load a persisted override on app start; falls back to the device locale. */
export async function initLocale(): Promise<void> {
  try {
    const saved = await getStoredString(STORAGE_KEY);
    if (saved && SUPPORTED_LOCALES.includes(saved as AppLocale) && saved !== currentLocale) {
      currentLocale = saved as AppLocale;
      notify();
    }
  } catch {
    // Ignore — keep the device-detected locale.
  }
}
