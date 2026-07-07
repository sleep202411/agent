import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultLocale, type Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { getNarrativePlayable } from "@/src/features/narrative/narrative-games";
import { IpNarrativePlayer } from "../_components/ip-narrative-player";

export const metadata: Metadata = {
  title: "Play",
  description: "Play a FizzDragon interactive story.",
};

export default async function NarrativePlayPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const legacyPlayable = getNarrativePlayable(id);
  if (legacyPlayable) {
    const locale = ((await headers()).get("x-locale") ?? defaultLocale) as Locale;
    redirect(localizePath(`/play/${legacyPlayable.sourceIpId}`, locale));
  }
  return <IpNarrativePlayer ipId={id} />;
}
