import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultLocale, isValidLocale } from "@/src/i18n/config";

export default async function Page() {
  const localeHeader = (await headers()).get("x-locale") ?? defaultLocale;
  const locale = isValidLocale(localeHeader) ? localeHeader : defaultLocale;
  redirect(`/${locale}/ips`);
}
