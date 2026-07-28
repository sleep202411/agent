import type { NotificationDTO } from "@repo/shared/notifications";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

/**
 * The router target for a notification, or `null` when it has none.
 *
 * The server stores `meta.deeplink` locale-agnostic
 * (`/crews/{id}/workspace?tab=episodes&episode={id}`) — it has no idea
 * which locale the reader is browsing. Pushing that raw hands the URL
 * to `proxy.ts`, which 307s and re-resolves the locale from the
 * NEXT_LOCALE cookie, then Accept-Language, then en-US; a zh-HK reader
 * whose cookie says zh-CN lands in the wrong language, and every click
 * pays a round trip. Prefixing here keeps the reader where they are.
 *
 * `meta` is an open `Record<string, unknown>` on the wire, so the shape
 * check is load-bearing rather than defensive: a producer that ships a
 * non-string deeplink must yield "no navigation", not a stringified
 * object in the address bar.
 */
export function notificationHref(n: NotificationDTO, locale: Locale): string | null {
  const deeplink = n.meta?.deeplink;
  if (typeof deeplink !== "string" || deeplink === "") return null;
  return localizePath(deeplink, locale);
}
