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
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { IconArrowRight } from "@tabler/icons-react";
import { BlurText } from "@/components/ui/blur-text";
import { ShinyText } from "@/components/ui/shiny-text";
import { StarBorder } from "@/components/ui/star-border";
import { Noise } from "@/components/ui/noise";
import { GradualBlur } from "@/components/ui/gradual-blur";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useCurrentUser } from "@/src/hooks/use-user";

// Primary backdrop — looping muted videos served from the OSS static
// CDN (same bucket as HERO_POSTER). The pool is randomized on mount;
// until the random pick lands the <video> shows the poster so the
// section is never blank. The poster also serves as the fallback if
// autoplay is blocked. To swap a clip: re-upload to the same path via
// the `/content/public/upload/static` endpoint with `dir=pc`.
const HERO_VIDEOS = [
  "https://static.fizzspace.cn/static/pc/hero-bg-1.mp4",
  "https://static.fizzspace.cn/static/pc/hero-bg-2.mp4",
] as const;
const HERO_POSTER =
  "https://static.fizzspace.cn/static/pc/ChatGPT%20Image%202026%E5%B9%B44%E6%9C%8827%E6%97%A5%2012_25_56.png";

export function Hero() {
  const locale = useLocale() as Locale;
  const t = useTranslations("home");
  const { user } = useCurrentUser();
  // Already-signed-in visitors landing here from a refresh / back-nav
  // shouldn't be bounced to /login. Send them straight into the
  // platform's main work surface; logged-out users still get /login.
  const primaryCtaHref = localizePath(user ? "/art-studio" : "/login", locale);

  // Pick the video on mount only — server-rendered HTML omits `src` so
  // the SSR/CSR markup stays identical (no hydration mismatch). The
  // poster covers the moment between hydration and the effect firing.
  const [videoSrc, setVideoSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    setVideoSrc(HERO_VIDEOS[Math.floor(Math.random() * HERO_VIDEOS.length)]);
  }, []);

  return (
    <section className="relative h-screen min-h-[680px] overflow-hidden">
      {/* Backdrop — looping silent video. autoPlay+muted+playsInline are
          required together for autoplay on iOS Safari + Chrome data-saver. */}
      <video
        key={videoSrc ?? "poster"}
        src={videoSrc}
        poster={HERO_POSTER}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 size-full object-cover"
      />

      {/* Legibility layers — top dim + radial vignette. The bottom edge is
          handled by <GradualBlur position="bottom"> below, which gives the
          backdrop a real progressive blur instead of just a darkening fade. */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background/60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(0,0,0,0.55)_85%)]" />

      {/* Bottom-edge gradient blur — backdrop image fades into mist before
          handing off to the next section. divCount=8 keeps the gradient
          smooth, exponential ramp so the very-bottom is properly blurred. */}
      <GradualBlur
        position="bottom"
        height="14rem"
        strength={2.5}
        divCount={8}
        exponential
        curve="ease-out"
        zIndex={1}
      />

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
          <BlurText
            text={t("hero.headlineLine2")}
            animateBy="words"
            direction="top"
            delay={120}
            stepDuration={0.4}
            className="justify-center bg-gradient-to-r from-violet-300 via-fuchsia-200 to-amber-200 bg-clip-text text-transparent"
          />
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
              // Open studio in a new tab so the marketing site stays
              // open in the original one. Login still navigates in
              // place — `/login?redirect=` round-trips back here.
              target={user ? "_blank" : undefined}
              rel={user ? "noopener noreferrer" : undefined}
              className="flex h-14 items-center gap-3 rounded-full bg-white px-8 text-base font-semibold text-black transition-colors hover:bg-white/90"
            >
              {t("hero.primaryCta")}
              <IconArrowRight className="size-5" strokeWidth={2.5} />
            </Link>
          </StarBorder>
          <Link
            href={localizePath("/ips", locale)}
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
