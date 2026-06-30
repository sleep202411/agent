import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultLocale, type Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { PRIMARY_NARRATIVE_PLAYABLE_ID } from "@/src/features/narrative/narrative-games";

export const metadata: Metadata = {
  title: "Narrative Demo",
  description: "A FizzDragon prototype for AI text RPG onboarding and play.",
};

export default async function NarrativeDemoPage() {
  const locale = ((await headers()).get("x-locale") ?? defaultLocale) as Locale;
  redirect(localizePath(`/play/${PRIMARY_NARRATIVE_PLAYABLE_ID}`, locale));
}
