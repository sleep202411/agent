import type { Metadata } from "next";
import { headers } from "next/headers";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { defaultLocale, isValidLocale, type Locale } from "@/src/i18n/config";
import { TvApp } from "./_components/tv-app";

const TV_COPY = {
  "en-US": enUS.tv,
  "zh-CN": zhCN.tv,
  "zh-HK": zhHK.tv,
} satisfies Record<Locale, { metadataTitle: string; metadataDescription: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const headerBag = await headers();
  const localeHeader = headerBag.get("x-locale") ?? defaultLocale;
  const locale: Locale = isValidLocale(localeHeader) ? localeHeader : defaultLocale;
  const copy = TV_COPY[locale];
  return {
    title: copy.metadataTitle,
    description: copy.metadataDescription,
    alternates: { canonical: "/tv" },
  };
}

export default function TvPage() {
  // Chrome-less fullscreen surface (top-level route, sibling of /play): the
  // plaza's TV button links here; the top-right X closes back to
  // the plaza. The root layout already supplies the dark canvas, React
  // Query provider, and toasts.
  return (
    <main className="relative h-[100dvh] overflow-hidden text-white">
      <TvApp />
    </main>
  );
}
