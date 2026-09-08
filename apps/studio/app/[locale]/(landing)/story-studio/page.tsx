import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { SiteRegion } from "@/app/_components/region-provider";
import { getWebBaseUrl } from "@/lib/web-base";
import { StoryProjectLibrary } from "../../(studio)/story-studio/_components/story-project-library";

/**
 * The Hero's primary button, in every region and locally.
 *
 * `/play/jinling-v2` is the self-contained frozen showcase, deployed with the
 * web app itself, so it cannot be broken by a catalogue that lacks a release.
 * It previously pointed, in the global region only, at
 * `/play/interactive-film/019f6e2b-…` — a Story Project that was never
 * published, so Java answered `game not found` and the button was dead from the
 * day it was added. A Story Project id is not evidence of a release; only the
 * Java catalogue is.
 *
 * The serial release of 入梦金陵 lives at
 * `/play/interactive-film/019f993d-aecc-7020-b59f-3fec0fb7bfc6` and plays, but
 * it is deliberately not what this Hero features.
 */
const JINLING_PLAYER_PATH = "/play/jinling-v2";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("storyStudio");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function StoryStudioPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const rawRegion = process.env.SITE_REGION ?? process.env.NEXT_PUBLIC_SITE_REGION ?? "global";
  const siteRegion: SiteRegion = rawRegion === "cn" ? "cn" : "global";
  const playerBase = getWebBaseUrl(siteRegion);
  const playerHref = `${playerBase}/${locale}${JINLING_PLAYER_PATH}`;

  return (
    <div className="relative min-h-screen bg-[#101112] text-white antialiased">
      <main className="relative min-h-screen overflow-x-clip pb-16">
        <StoryProjectLibrary featuredPlayerHref={playerHref} />
      </main>
    </div>
  );
}
