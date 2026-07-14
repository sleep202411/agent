import type { Metadata } from "next";
import { headers } from "next/headers";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { JinlingGameEntry } from "@/src/features/jinling-rumeng/ui/JinlingGameEntry";
import type { Locale } from "@/src/i18n/config";

const METADATA_BY_LOCALE = {
  "en-US": enUS.jinlingRumeng.meta,
  "zh-CN": zhCN.jinlingRumeng.meta,
  "zh-HK": zhHK.jinlingRumeng.meta,
} satisfies Record<Locale, { title: string; description: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = ((await headers()).get("x-locale") ?? "en-US") as Locale;
  return METADATA_BY_LOCALE[locale];
}

export default function JinlingRumengV2Page() {
  return <JinlingGameEntry storyVariant="v2" />;
}
