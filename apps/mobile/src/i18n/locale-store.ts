import * as Localization from "expo-localization";

import { type AppLocale } from "@/config";
import { invalidateBrowse } from "@/data/browse-refresh";
import { getStoredString, setStoredString } from "@/lib/persistent-storage";

/**
 * Reactive locale store — mirrors the auth store pattern (external store +
 * useSyncExternalStore). The initial locale follows the device language
 * (synchronous, so first paint is correct); a user override persisted through
 * the app storage adapter takes over once `initLocale` resolves.
 */
export const SUPPORTED_LOCALES: AppLocale[] = ["en-US", "zh-CN", "zh-HK"];
const STORAGE_KEY = "fizzdragon.locale.override";

// Follow the device language; anything we don't localize into falls back to
// English (product decision 2026-07-04 — was: per-region build default).
const FALLBACK_LOCALE: AppLocale = "en-US";

/** Map any BCP-47 device tag to one of our supported locales. */
function mapToSupported(tag: string | null | undefined): AppLocale {
  if (!tag) return FALLBACK_LOCALE;
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) {
    // Traditional Chinese (Hant / HK / TW / MO) → zh-HK, otherwise Simplified.
    return /hant|hk|tw|mo/.test(lower) ? "zh-HK" : "zh-CN";
  }
  if (lower.startsWith("en")) return "en-US";
  return FALLBACK_LOCALE;
}

function detectDeviceLocale(): AppLocale {
  try {
    const locales = Localization.getLocales();
    return mapToSupported(locales?.[0]?.languageTag);
  } catch {
    return FALLBACK_LOCALE;
  }
}

let currentLocale: AppLocale = detectDeviceLocale();
let hasExplicitSelection = false;
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
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  // A deliberate selection wins over an outstanding startup storage read,
  // including selecting the device language already displayed.
  hasExplicitSelection = true;
  if (locale !== currentLocale) {
    currentLocale = locale;
    notify();
    // Server responses are locale-dependent; refetch only when the locale changes.
    invalidateBrowse();
  }
  void setStoredString(STORAGE_KEY, locale).catch(() => {});
}

/** Load a persisted override on app start; falls back to the device locale. */
export async function initLocale(): Promise<void> {
  try {
    const saved = await getStoredString(STORAGE_KEY);
    if (hasExplicitSelection) return;
    if (saved && SUPPORTED_LOCALES.includes(saved as AppLocale) && saved !== currentLocale) {
      currentLocale = saved as AppLocale;
      notify();
      // The override lands async after app start — anything fetched with the
      // device-detected locale in the meantime is stale.
      invalidateBrowse();
    }
  } catch {
    // Ignore — keep the device-detected locale.
  }
}
