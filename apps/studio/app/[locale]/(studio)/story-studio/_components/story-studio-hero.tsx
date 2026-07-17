"use client";

import { IconBook2, IconPlayerPlay } from "@tabler/icons-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { useSiteRegion } from "@/app/_components/region-provider";
import { Link } from "@/i18n/navigation";

const JINLING_HERO_VIDEO =
  "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/interactive-films/jinling-rumeng/s01/v2/film-cut/s01-gate-arrival.mp4";
const JINLING_HERO_POSTER = "/story-studio/jinling-rumeng-gate-arrival.jpg";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const PRIMARY_CTA_CLASS =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[15px] bg-white px-4 text-[14px] font-bold text-black shadow-[0_12px_28px_rgba(0,0,0,0.24)] transition hover:bg-white/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40";

function subscribeToReducedMotion(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot() {
  // Keep video sources out of the server HTML. This prevents motion-reduced
  // clients from starting a download before React can read matchMedia().
  return true;
}

export function StoryStudioHero({
  featuredProjectHref,
  playerHref,
}: {
  featuredProjectHref: string | null;
  playerHref: string;
}) {
  const t = useTranslations("storyStudioLanding");
  const siteRegion = useSiteRegion();
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  );
  // The film source currently lives in the global Azure cell. CN keeps the
  // same fixed Hero composition using the bundled poster, without a cross-cell
  // media request.
  const shouldPlayVideo = siteRegion === "global" && !prefersReducedMotion;

  return (
    <section
      aria-labelledby="story-studio-hero-title"
      className="relative min-h-[590px] overflow-hidden bg-[#101112] sm:min-h-0 sm:h-[525px]"
    >
      <Image
        src={JINLING_HERO_POSTER}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        aria-hidden="true"
      />
      {shouldPlayVideo ? (
        <video
          className="absolute inset-0 size-full object-cover"
          src={JINLING_HERO_VIDEO}
          poster={JINLING_HERO_POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
          disablePictureInPicture
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,17,18,0.92)_0%,rgba(16,17,18,0.58)_48%,rgba(16,17,18,0.12)_100%),linear-gradient(180deg,rgba(16,17,18,0.68)_0%,rgba(16,17,18,0.08)_28%,rgba(16,17,18,0.64)_100%)]" />

      <div className="relative z-10 flex min-h-[590px] items-end px-6 pt-28 pb-14 sm:h-[525px] sm:min-h-0 sm:items-center sm:px-20 sm:py-20 lg:px-[120px]">
        <div className="max-w-[660px]">
          <span className="inline-flex rounded-full bg-white/[0.09] px-3 py-1.5 text-[11px] font-semibold text-white/72 backdrop-blur-md">
            {t("badge")}
          </span>
          <p className="mt-4 mb-3 text-[11px] font-semibold tracking-[0.18em] text-white/58 uppercase">
            {t("hero.eyebrow")}
          </p>
          <h1
            id="story-studio-hero-title"
            className="max-w-[560px] text-[38px] leading-[1.02] font-semibold tracking-[-0.025em] text-white sm:text-[48px]"
          >
            {t("hero.title")}
          </h1>
          <p className="mt-6 max-w-[660px] text-[15px] leading-6 font-medium text-white/86 sm:mt-7 sm:text-[17px]">
            {t("hero.description")}
          </p>
          <div className="mt-5 flex flex-col items-stretch gap-2 min-[430px]:flex-row min-[430px]:items-center">
            {featuredProjectHref ? (
              <Link href={featuredProjectHref} className={PRIMARY_CTA_CLASS}>
                <IconBook2 className="size-4" stroke={2.1} aria-hidden="true" />
                {t("hero.openCanvas")}
              </Link>
            ) : (
              <a href="#interactive-films" className={PRIMARY_CTA_CLASS}>
                <IconBook2 className="size-4" stroke={2.1} aria-hidden="true" />
                {t("hero.browseProjects")}
              </a>
            )}
            <a
              href={playerHref}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[15px] bg-black/55 px-4 text-[14px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.2)] backdrop-blur-md transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
            >
              <IconPlayerPlay className="size-4 fill-white" stroke={2.1} aria-hidden="true" />
              {t("hero.playFilm")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
