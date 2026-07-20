import type { Metadata } from "next";
import { headers } from "next/headers";
import type { Locale } from "@/src/i18n/config";
import { JinlingGameEntry } from "./_frozen/jinling-rumeng/ui/JinlingGameEntry";

// Frozen showcase route —《金陵入梦 · 无字来客》v2 (26-clip Seedance 2.0 cut).
// Everything it needs lives under ./_frozen; see the README there before
// touching anything. Metadata is inlined so this page has no dependency on
// the app-wide messages/*.json.
const METADATA_BY_LOCALE = {
  "en-US": {
    title: "Dream of Jinling · The Unwritten Visitor",
    description: "Create an original character and enter the world of the Red Chamber.",
  },
  "zh-CN": {
    title: "金陵入梦 · 无字来客",
    description: "创建原创角色，以第一视角进入红楼世界，让每一次选择写下未曾预言的命运。",
  },
  "zh-HK": {
    title: "金陵入夢 · 無字來客",
    description: "建立原創角色，以第一視角進入紅樓世界，讓每一次選擇寫下未曾預言的命運。",
  },
} satisfies Record<Locale, { title: string; description: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = ((await headers()).get("x-locale") ?? "en-US") as Locale;
  return METADATA_BY_LOCALE[locale] ?? METADATA_BY_LOCALE["en-US"];
}

export default function JinlingRumengV2Page() {
  return <JinlingGameEntry storyVariant="v2" />;
}
