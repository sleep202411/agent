import type { AppLocale } from "@/config";
import { webBaseUrl } from "@/config";

/**
 * Absolute web play URL for share links. Matches the web `PlayShareButton` path
 * shape so a shared link opens the same chapter on site.
 */
export function buildExperiencePlayShareUrl(options: {
  gameId: string;
  locale: AppLocale | string;
  chapterId?: string | null;
}): string {
  const locale = options.locale.trim() || "en-US";
  const path = `/${locale}/play/interactive-film/${encodeURIComponent(options.gameId)}`;
  const url = new URL(path, `${webBaseUrl.replace(/\/+$/, "")}/`);
  if (options.chapterId?.trim()) {
    url.searchParams.set("chapter", options.chapterId.trim());
  }
  return url.toString();
}
