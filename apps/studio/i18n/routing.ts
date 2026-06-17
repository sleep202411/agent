import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

/**
 * next-intl routing: the locale lives in the URL path (e.g. /en-US, /zh-CN/canvas).
 * `localePrefix: "always"` prefixes every locale including the default, so the
 * bare `/` redirects to the detected (or default) locale.
 */
export const routing = defineRouting({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always",
});
