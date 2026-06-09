import * as Localization from "expo-localization";
import * as SecureStore from "expo-secure-store";

import type { AppLocale } from "@/config";

/**
 * Reactive locale store — mirrors the auth store pattern (external store +
 * useSyncExternalStore). The initial locale follows the device language
 * (synchronous, so first paint is correct); a user override persisted in
 * SecureStore takes over once `initLocale` resolves.
 */
export const SUPPORTED_LOCALES: AppLocale[] = ["en-US", "zh-CN", "zh-HK"];
const STORAGE_KEY = "fizzdragon.locale.override";

/** Map any BCP-47 device tag to one of our supported locales. */
function mapToSupported(tag: string | null | undefined): AppLocale {
  if (!tag) return "en-US";
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) {
    // Traditional Chinese (Hant / HK / TW / MO) → zh-HK, otherwise Simplified.
    return /hant|hk|tw|mo/.test(lower) ? "zh-HK" : "zh-CN";
  }
  return "en-US";
}

function detectDeviceLocale(): AppLocale {
  try {
    const locales = Localization.getLocales();
    return mapToSupported(locales?.[0]?.languageTag);
  } catch {
    return "en-US";
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
  void SecureStore.setItemAsync(STORAGE_KEY, locale).catch(() => {});
}

/** Load a persisted override on app start; falls back to the device locale. */
export async function initLocale(): Promise<void> {
  try {
    const saved = await SecureStore.getItemAsync(STORAGE_KEY);
    if (saved && SUPPORTED_LOCALES.includes(saved as AppLocale) && saved !== currentLocale) {
      currentLocale = saved as AppLocale;
      notify();
    }
  } catch {
    // Ignore — keep the device-detected locale.
  }
}
