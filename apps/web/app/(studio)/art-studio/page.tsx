"use client";

import { useEffect, useRef, useState } from "react";
import { RecentProjectsPreview } from "./_components/recent-projects-preview";
import { StickyComposerPill } from "./_components/sticky-composer-pill";
import { StudioHomeComposer } from "./_components/studio-home-composer";

// Placeholder backdrop — re-uses the marketing-site hero clips until
// studio gets its own cinematic loop. Replace these URLs once dedicated
// studio backdrops are produced (same OSS bucket, `dir=pc`).
const BG_VIDEOS = [
  "https://static.fizzspace.cn/static/pc/hero-bg-1.mp4",
  "https://static.fizzspace.cn/static/pc/hero-bg-2.mp4",
] as const;
const BG_POSTER =
  "https://static.fizzspace.cn/static/pc/ChatGPT%20Image%202026%E5%B9%B44%E6%9C%8827%E6%97%A5%2012_25_56.png";

export default function StudioHomePage() {
  const heroRef = useRef<HTMLDivElement>(null);

  // Random pick deferred to the client so SSR/CSR markup stays
  // identical (no hydration mismatch). The poster covers the gap
  // between hydration and the effect firing.
  const [videoSrc, setVideoSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    setVideoSrc(BG_VIDEOS[Math.floor(Math.random() * BG_VIDEOS.length)]);
  }, []);

  // Backdrop fade — opacity 1 at the top, 0 once the user has
  // scrolled ~70% of a viewport down. Past that point recent-projects
  // (and beyond) sits on the solid app background, no video noise
  // behind the cards. Scroll listener uses rAF coalescing so we never
  // do more than one paint per frame even on a fast trackpad.
  const [bgOpacity, setBgOpacity] = useState(1);
  useEffect(() => {
    let rafId = 0;
    const update = () => {
      rafId = 0;
      const fadeEnd = window.innerHeight * 0.7;
      const next = Math.max(0, Math.min(1, 1 - window.scrollY / fadeEnd));
      setBgOpacity(next);
    };
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="relative">
      {/* Fixed-position backdrop — full-bleed hero feel at the top,
          fades to 0 as the user scrolls (see `bgOpacity` above) so
          recent-projects below sits on a clean solid background.
          z-0 puts the layer above body bg; content gets z-10; sticky
          nav at z-40 stays on top. */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{ opacity: bgOpacity }}
        aria-hidden
      >
        <video
          key={videoSrc ?? "poster"}
          src={videoSrc}
          poster={BG_POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="size-full object-cover"
        />
        {/* Legibility overlay — slight darken + radial vignette so
            the composer text reads against any frame of the clip. */}
        <div className="absolute inset-0 bg-background/55" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at center, transparent 20%, rgba(0,0,0,0.55) 85%)",
          }}
        />
      </div>

      {/* Content wrapper — capped at 1800px so cards don't stretch on
          ultra-wide screens. Padding scales up at `lg` to clear the
          floating sidebar on the left (~72px occupied), applied
          symmetrically on both sides so the content reads as centered
          rather than nudged off-axis. */}
      <div className="relative z-10 mx-auto flex min-h-full w-full max-w-450 flex-col gap-16 px-8 pb-24 pt-16 lg:px-24">
        <div ref={heroRef}>
          <StudioHomeComposer />
        </div>
        <RecentProjectsPreview />
      </div>
      <StickyComposerPill heroRef={heroRef} />
    </div>
  );
}
