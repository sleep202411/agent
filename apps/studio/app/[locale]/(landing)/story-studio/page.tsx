import type { Metadata } from "next";
import { headers } from "next/headers";
import { IconBook2, IconPlayerPlay } from "@tabler/icons-react";
import { getTranslations } from "next-intl/server";
import type { SiteRegion } from "@/app/_components/region-provider";
import { Link } from "@/i18n/navigation";
import { getWebBaseUrl } from "@/lib/web-base";
import { StoryProjectLibrary } from "../../(studio)/story-studio/_components/story-project-library";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("storyStudio");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

const HERO_VIDEO =
  "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/interactive-films/jinling-rumeng/s01/v1/film-cut-v2/a1-s03-gate-arrival.mp4";

export default async function StoryStudioPage({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, requestHeaders, t] = await Promise.all([
    params,
    headers(),
    getTranslations("storyStudioLanding"),
  ]);
  const rawRegion = process.env.SITE_REGION ?? process.env.NEXT_PUBLIC_SITE_REGION ?? "global";
  const siteRegion: SiteRegion = rawRegion === "cn" ? "cn" : "global";
  const host = requestHeaders.get("host") ?? "";
  const playerBase = host.startsWith("localhost")
    ? "http://localhost:9527"
    : getWebBaseUrl(siteRegion);

  return (
    <div className="relative min-h-screen bg-[#101112] text-white antialiased">
      <main className="relative min-h-screen overflow-x-clip pb-16">
        <section className="relative h-[525px] overflow-hidden">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src={HERO_VIDEO}
            autoPlay
            muted
            loop
            playsInline
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,17,18,0.88)_0%,rgba(16,17,18,0.52)_46%,rgba(16,17,18,0.08)_100%),linear-gradient(180deg,rgba(16,17,18,0.6)_0%,rgba(16,17,18,0.05)_22%,rgba(16,17,18,0.55)_100%)]" />

          <div className="absolute top-[128px] left-20 z-10 max-w-[640px] lg:left-[120px]">
            <span className="inline-flex rounded-full bg-white/[0.09] px-3 py-1.5 text-[11px] font-semibold text-white/72 backdrop-blur-md">
              {t("badge")}
            </span>
            <p className="mt-4 mb-3 text-[11px] font-semibold tracking-[0.18em] text-white/58 uppercase">
              {t("hero.eyebrow")}
            </p>
            <h1 className="max-w-[560px] text-[42px] leading-[1.02] font-semibold tracking-[-0.025em] text-white md:text-[48px]">
              {t("hero.title")}
            </h1>
            <p className="mt-7 max-w-[660px] text-[17px] leading-6 font-medium text-white/88">
              {t("hero.description")}
            </p>
            <div className="mt-5 flex items-center gap-2">
              <Link
                href="/story-studio/interactive-film/jinling"
                className="inline-flex h-10 items-center gap-2 rounded-[15px] bg-white px-4 text-[14px] font-bold text-black shadow-[0_12px_28px_rgba(0,0,0,0.24)] transition hover:bg-white/88"
              >
                <IconBook2 className="size-4" stroke={2.1} />
                {t("hero.openCanvas")}
              </Link>
              <a
                href={`${playerBase}/${locale}/play/jinling-v2`}
                className="inline-flex h-10 items-center gap-2 rounded-[15px] bg-black/55 px-4 text-[14px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.2)] transition hover:bg-black/70"
              >
                <IconPlayerPlay className="size-4 fill-white" stroke={2.1} />
                {t("hero.playFilm")}
              </a>
            </div>
          </div>
        </section>

        <StoryProjectLibrary />
      </main>
    </div>
  );
}
