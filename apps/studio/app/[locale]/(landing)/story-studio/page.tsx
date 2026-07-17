import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { SiteRegion } from "@/app/_components/region-provider";
import { getWebBaseUrl } from "@/lib/web-base";
import { StoryProjectLibrary } from "../../(studio)/story-studio/_components/story-project-library";

const JINLING_PLAYER_PATH_BY_REGION: Record<SiteRegion, string> = {
  // Published Experience Runtime release in the global Java catalogue.
  global: "/play/interactive-film/019f6e2b-3da1-74b8-b0e4-d816ca733ca9",
  // The CN catalogue does not yet contain the formal release. Keep this Hero
  // useful there by linking to the deployed frozen showcase instead of a 404.
  cn: "/play/jinling-v2",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("storyStudio");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function StoryStudioPage({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()]);
  const rawRegion = process.env.SITE_REGION ?? process.env.NEXT_PUBLIC_SITE_REGION ?? "global";
  const siteRegion: SiteRegion = rawRegion === "cn" ? "cn" : "global";
  const host = requestHeaders.get("host") ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const playerBase = isLocal ? "http://localhost:9527" : getWebBaseUrl(siteRegion);
  // The local Story Project has no publication yet, so it cannot serve the
  // global build's protected media through the local Aurora server.
  const playerPath = isLocal ? "/play/jinling-v2" : JINLING_PLAYER_PATH_BY_REGION[siteRegion];
  const playerHref = `${playerBase}/${locale}${playerPath}`;

  return (
    <div className="relative min-h-screen bg-[#101112] text-white antialiased">
      <main className="relative min-h-screen overflow-x-clip pb-16">
        <StoryProjectLibrary featuredPlayerHref={playerHref} />
      </main>
    </div>
  );
}
