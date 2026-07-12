import type { Metadata } from "next";
import { headers } from "next/headers";
import { IconBook2, IconPlayerPlay } from "@tabler/icons-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { SiteRegion } from "@/app/_components/region-provider";
import { getWebBaseUrl } from "@/lib/web-base";
import {
  StoryShelf,
  type StoryStudioStory,
} from "../../story-studio/_components/story-studio-shelves";

export const metadata: Metadata = {
  title: "Story Studio",
  description:
    "Create playable stories and interactive films with scenes, media, choices, and endings.",
};

const HERO_VIDEO =
  "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/interactive-films/jinling-rumeng/s01/v1/film-cut-v2/a1-s03-gate-arrival.mp4";

const STORY_STUDIO_ITEMS: StoryStudioStory[] = [
  {
    title: "金陵入梦",
    eyebrow: "Official interactive-film example",
    description:
      "Open a production-ready cinematic branch map with 56 published video and audio assets, four chapters, and five endings.",
    estimatedPlayTime: "6-8 min",
    image: "/gallery/seed/studio-library-lantern-dragon.jpg",
    video:
      "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/interactive-films/jinling-rumeng/s01/v1/film-cut-v2/a1-s03-gate-arrival.mp4",
    href: "/story-studio/interactive-film/jinling",
  },
  {
    title: "Locked Campus",
    eyebrow: "School suspense",
    description:
      "A contained school thriller where every hallway, rule, and witness statement can shift the route.",
    estimatedPlayTime: "25-40 min",
    image: "/gallery/seed/studio-rainfall-action-storyboard.jpg",
  },
  {
    title: "Evidence Chain",
    eyebrow: "Investigation",
    description:
      "A clue-first structure for branching cases, global evidence, and AI-guided reasoning turns.",
    estimatedPlayTime: "30-45 min",
    image: "/gallery/seed/concept-story-archive-cover.jpg",
  },
  {
    title: "Brother Protocol",
    eyebrow: "Character pressure",
    description:
      "A character-driven setup where protection, surveillance, and intervention become dramatic gates.",
    estimatedPlayTime: "40-60 min",
    image: "/gallery/seed/studio-neon-story-panels.jpg",
  },
  {
    title: "After Class",
    description:
      "A quiet campus drama built from social pressure, missing context, and fragile trust.",
    estimatedPlayTime: "20-30 min",
    image: "/gallery/seed/studio-library-lantern-dragon.jpg",
  },
  {
    title: "The Missing Hour",
    description: "A time-gap mystery where each player action reconstructs one hidden hour.",
    estimatedPlayTime: "30-45 min",
    image: "/gallery/seed/studio-holographic-timeline-desk.jpg",
  },
  {
    title: "Night Record",
    description:
      "A dark-room narrative template for documents, recorded memories, and false testimony.",
    estimatedPlayTime: "25-35 min",
    image: "/gallery/seed/studio-dark-creative-interior.jpg",
  },
  {
    title: "Silent Witness",
    description:
      "A character-led story where what is not said matters more than each direct answer.",
    estimatedPlayTime: "20-35 min",
    image: "/gallery/seed/people-night-market-youth-portrait.jpg",
  },
];

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
  const playerHref = `${playerBase}/${locale}/play/jinling`;

  return (
    <div className="relative min-h-screen bg-[#101112] text-white antialiased">
      {/* Header + icon rail come from the (landing) layout; the hero runs
          full-bleed underneath the floating header. */}
      <main className="relative min-h-screen overflow-x-clip pb-16">
        <Hero
          eyebrow={t("hero.eyebrow")}
          title={t("hero.title")}
          description={t("hero.description")}
          previewNotice={t("previewNotice")}
          openCanvasLabel={t("hero.openCanvas")}
          playLabel={t("hero.playFilm")}
          playerHref={playerHref}
        />
        <section className="relative z-20 pr-6 pl-20 pt-12 lg:pl-[120px]">
          <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-white">Examples</h2>
          <p className="mt-1 text-[13px] font-medium text-white/48">
            Open the official interactive-film production example, or explore reusable story shapes.
          </p>
        </section>
        <StoryShelf stories={STORY_STUDIO_ITEMS} />
      </main>
    </div>
  );
}

function Hero({
  eyebrow,
  title,
  description,
  previewNotice,
  openCanvasLabel,
  playLabel,
  playerHref,
}: {
  eyebrow: string;
  title: string;
  description: string;
  previewNotice: string;
  openCanvasLabel: string;
  playLabel: string;
  playerHref: string;
}) {
  return (
    <section className="relative h-[525px] overflow-hidden">
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src={HERO_VIDEO}
        autoPlay
        muted
        loop
        playsInline
      />
      {/* Left/bottom scrims for copy + a top scrim so the floating header stays legible. */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,17,18,0.88)_0%,rgba(16,17,18,0.52)_46%,rgba(16,17,18,0.08)_100%),linear-gradient(180deg,rgba(16,17,18,0.6)_0%,rgba(16,17,18,0.05)_22%,rgba(16,17,18,0.55)_100%)]" />

      <div className="absolute top-[128px] left-20 z-10 max-w-[640px] lg:left-[120px]">
        <span className="inline-flex rounded-full bg-white/[0.09] px-3 py-1.5 text-[11px] font-semibold text-white/72 backdrop-blur-md">
          {previewNotice}
        </span>
        <p className="mb-3 text-[11px] font-semibold tracking-[0.18em] text-white/58 uppercase">
          {eyebrow}
        </p>
        <h1 className="max-w-[560px] text-[42px] leading-[1.02] font-semibold tracking-[-0.025em] text-white md:text-[48px]">
          {title}
        </h1>
        <p className="mt-7 max-w-[660px] text-[17px] leading-6 font-medium text-white/88">
          {description}
        </p>
        <div className="mt-5 flex items-center gap-2">
          <Link
            href="/story-studio/interactive-film/jinling"
            className="inline-flex h-10 items-center gap-2 rounded-[15px] bg-white px-4 text-[14px] font-bold text-black shadow-[0_12px_28px_rgba(0,0,0,0.24)] transition hover:bg-white/88"
          >
            <IconBook2 className="size-4" stroke={2.1} />
            {openCanvasLabel}
          </Link>
          <a
            href={playerHref}
            className="inline-flex h-10 items-center gap-2 rounded-[15px] bg-black/55 px-4 text-[14px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.2)] transition hover:bg-black/70"
          >
            <IconPlayerPlay className="size-4 fill-white" stroke={2.1} />
            {playLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
