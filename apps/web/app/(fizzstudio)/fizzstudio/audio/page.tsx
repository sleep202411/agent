import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getStudioHref } from "@/src/lib/region/cell";
import { defaultLocale, locales } from "@/src/i18n/config";

// Audio has one complete composer/feed in Studio, including playback and recovery.
export default async function AudioPage() {
  const requested = (await headers()).get("x-locale");
  const locale = locales.find((value) => value === requested) ?? defaultLocale;
  redirect(`${getStudioHref(locale)}/audio`);
}
