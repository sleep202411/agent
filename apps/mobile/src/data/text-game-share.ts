import { TextGameIdSchema, TextGameLocaleSchema } from "@repo/shared/text-game";
import { webBaseUrl } from "@/config";
export function textGameShareUrl(gameId: string, locale: string) {
  return new URL(
    `/${TextGameLocaleSchema.parse(locale)}/play/text-game/${TextGameIdSchema.parse(gameId)}`,
    `${webBaseUrl.replace(/\/+$/, "")}/`
  ).toString();
}
