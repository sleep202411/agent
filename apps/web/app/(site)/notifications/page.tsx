import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultLocale, isValidLocale } from "@/src/i18n/config";

/** The message center is the only inbox; preserve existing notification links. */
export default async function NotificationsPage() {
  const header = (await headers()).get("x-locale");
  const locale = header && isValidLocale(header) ? header : defaultLocale;
  redirect(`/${locale}/messages?tab=notifications`);
}
