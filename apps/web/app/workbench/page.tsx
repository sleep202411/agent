import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultLocale, isValidLocale } from "@/src/i18n/config";

// Preserve old workbench bookmarks through the real, persisted notification feed.
export default async function WorkbenchPage() {
  const requestedLocale = (await headers()).get("x-locale");
  const locale =
    requestedLocale && isValidLocale(requestedLocale) ? requestedLocale : defaultLocale;
  redirect(`/${locale}/messages?tab=notifications`);
}
