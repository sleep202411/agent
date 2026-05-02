/**
 * Feature-private translation hook for `/crews-v2`.
 *
 * Wraps the global `useLocale()` and looks the key up in the local
 * `MESSAGES` dictionary instead of the central `messages/*.json`
 * files. Type-safe — passing a key that doesn't exist on `en-US` is a
 * compile error. Supports `{name}` placeholders interpolated from a
 * second-arg `params` object.
 *
 * Why this lives in the feature folder: keeping every string for this
 * page next to the JSX that uses them means a future "rename / kill
 * crews-v2" can be done by deleting the folder and never touching
 * the central locale files.
 */
import { useLocale } from "@/src/i18n/i18n";
import { MESSAGES, type CrewsV2Key, type CrewsV2Locale } from "../_data/i18n";

export function useT() {
  const rawLocale = useLocale();
  const locale: CrewsV2Locale =
    (rawLocale as CrewsV2Locale) in MESSAGES ? (rawLocale as CrewsV2Locale) : "en-US";
  const dict = MESSAGES[locale];
  return (key: CrewsV2Key, params?: Record<string, string | number>): string => {
    // dict values are typed as a literal-union via `as const` — widen to
    // plain string so `replace` chains type cleanly with the reducer.
    const raw: string = dict[key];
    if (!params) return raw;
    return Object.entries(params).reduce<string>(
      (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
      raw
    );
  };
}
