import { notificationTarget, type NotificationDTO } from "@repo/shared/notifications";
import type { Locale } from "@/src/i18n/config";
import { studioOrigin } from "../studio-origin";

/** All notification surfaces use the same app, site and locale routing. */
export function notificationHref(n: NotificationDTO, locale: Locale): string | null {
  const target = notificationTarget(n);
  if (!target) return null;
  // `/project/:id` is a Studio UI route, not the similarly named Java API.
  const path = `/${locale}${target.path}`;
  return target.surface === "studio"
    ? `${studioOrigin(process.env.NEXT_PUBLIC_STUDIO_HOST)}${path}`
    : path;
}
