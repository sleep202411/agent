import { notificationTarget, type NotificationDTO } from "@repo/shared/notifications";
import type { SiteRegion } from "@/app/_components/region-provider";
import { getWebBaseUrl } from "@/lib/web-base";

export function notificationHref(
  n: NotificationDTO,
  locale: string,
  region: SiteRegion
): string | null {
  const target = notificationTarget(n);
  if (!target) return null;
  const path = `/${locale}${target.path}`;
  return target.surface === "studio" ? path : `${getWebBaseUrl(region)}${path}`;
}
