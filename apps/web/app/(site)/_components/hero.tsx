"use client";

/**
 * Hero — full-bleed cinematic still with slow Ken Burns + tagline + CTAs.
 *
 * The backdrop image is a free Unsplash photo (Unsplash License: free
 * for commercial use, no attribution required). Swap `HERO_IMAGE` for
 * our own production still when one is ready. The marquee strip at the
 * bottom is a "what's possible" preview using a row of free cinematic
 * stills — same swap policy.
 */

import Link from "next/link";
import { useRef, useState } from "react";
import { motion } from "motion/react";
import { IconArrowRight, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { BlurText } from "@/components/ui/blur-text";
import { ShinyText } from "@/components/ui/shiny-text";
import { StarBorder } from "@/components/ui/star-border";
import { Noise } from "@/components/ui/noise";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

// Primary backdrop — a single looping, muted UI-showcase clip (webm with an
// mp4 fallback); the poster covers the moment before playback and is the
// fallback if autoplay is blocked. Hosted on Azure Blob (public `static`
// container) so the binaries stay out of git.
const HERO_CDN = "https://fizzdragonblob.blob.core.windows.net/static";
const HERO_POSTER = `${HERO_CDN}/hero-poster.jpg`;

export function Hero() {
  const locale = useLocale() as Locale;
  const t = useTranslations("home");
  // CTAs:
  //   primary   (hero.primaryCta)   → /ips         — browse the story library.
  //   secondary (hero.secondaryCta) → /art-studio  — jump into the studio.
  const primaryCtaHref = localizePath("/ips", locale);
  const secondaryCtaHref = localizePath("/art-studio", locale);

  // Optional soundtrack for the backdrop video — muted autoplay is mandatory,
  // so sound is opt-in via the toggle.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  const toggleSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (soundOn) {
      audio.pause();
      setSoundOn(false);
    } else {
      void audio
        .play()
        .then(() => setSoundOn(true))
        .catch(() => {});
    }
  };

  return (
    <section className="relative h-screen min-h-[680px] overflow-hidden">
      {/* Backdrop — looping silent video. autoPlay+muted+playsInline are
          required together for autoplay on iOS Safari + Chrome data-saver. */}
      <video
        poster={HERO_POSTER}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 size-full object-cover"
      >
        <source src={`${HERO_CDN}/hero.webm`} type="video/webm" />
        <source src={`${HERO_CDN}/hero.mp4`} type="video/mp4" />
      </video>

      {/* Soundtrack — separate looping track, opt-in via the button. */}
      <audio ref={audioRef} src={`${HERO_CDN}/hero-audio.mp3`} loop preload="none" />

      {/* Sound toggle */}
      <button
        type="button"
        onClick={toggleSound}
        aria-label={soundOn ? "Mute soundtrack" : "Play soundtrack"}
        className="absolute right-8 bottom-8 z-30 flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/90 backdrop-blur transition-colors hover:border-white/25 hover:bg-white/[0.12]"
      >
        {soundOn ? (
          <IconVolume className="size-5" stroke={1.8} />
        ) : (
          <IconVolumeOff className="size-5" stroke={1.8} />
        )}
      </button>

      {/* Legibility layers — top dim + radial vignette + a soft bottom fade
          into the next section. */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background/60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(0,0,0,0.55)_85%)]" />

      {/* Film-grain overlay — subtle cinema feel, ~0.5KB JS keeps a 1024×1024
          canvas regenerating noise every other frame. patternAlpha low so
          it doesn't fight the underlying image. */}
      <Noise patternAlpha={12} patternRefreshInterval={3} />

      {/* Content — single centered column, generous vertical rhythm */}
      <div className="relative z-20 flex h-full flex-col items-center justify-center px-6 text-center">
        {/* 1. Status pill — green dot + announcement copy. Swap text when a
              new model lands (e.g. "Veo 3 now rendering"). */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm text-white/80 backdrop-blur"
        >
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          <ShinyText
            text={t("hero.statusPill")}
            color="rgba(255,255,255,0.7)"
            shineColor="#ffffff"
            speed={3}
            delay={2}
          />
        </motion.div>

        {/* 2. Headline — BlurText reveals each word with a 2-step blur ramp. */}
        <div className="mt-10 max-w-6xl text-balance text-5xl font-semibold tracking-tight text-white sm:text-6xl md:text-7xl lg:text-[100px] lg:leading-[1.02]">
          <BlurText
            text={t("hero.headlineLine1")}
            animateBy="words"
            direction="top"
            delay={120}
            stepDuration={0.4}
            className="justify-center"
          />
          {/* Gradient line — rendered as one element (not BlurText) so the
              text is a direct child and `bg-clip-text` actually fills it; the
              per-word span approach would clip the gradient to nothing. */}
          <motion.div
            initial={{ opacity: 0, y: -20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.6, delay: 0.45 }}
            className="bg-gradient-to-r from-[#ff5257] via-[#e52227] to-[#cc1f23] bg-clip-text text-transparent"
          >
            {t("hero.headlineLine2")}
          </motion.div>
        </div>

        {/* 3. Subtitle — wider container, larger type, generous leading. */}
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.1 }}
          className="mt-10 max-w-3xl text-balance text-lg leading-relaxed text-white/75 sm:text-xl"
        >
          {t("hero.subtitle")}
        </motion.p>

        {/* 4. CTAs — tall pills, chevron icons, primary keeps the StarBorder rim. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.3 }}
          className="mt-14 flex flex-wrap items-center justify-center gap-4"
        >
          <StarBorder color="#ff8a4c" speed="5s" thickness={1.5}>
            <Link
              href={primaryCtaHref}
              className="flex h-14 items-center gap-3 rounded-full bg-white px-8 text-base font-semibold text-black transition-colors hover:bg-white/90"
            >
              {t("hero.primaryCta")}
              <IconArrowRight className="size-5" strokeWidth={2.5} />
            </Link>
          </StarBorder>
          <Link
            href={secondaryCtaHref}
            className="flex h-14 items-center gap-3 rounded-full border border-white/15 bg-white/[0.03] px-8 text-base font-semibold text-white/90 backdrop-blur transition-colors hover:border-white/25 hover:bg-white/[0.08]"
          >
            {t("hero.secondaryCta")}
            <IconArrowRight className="size-5" strokeWidth={2.5} />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
