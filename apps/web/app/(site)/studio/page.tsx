"use client";

import { useRef } from "react";
import { env } from "@/src/env";
import { ProjectsSection } from "./_components/projects-section";
import { StickyComposerPill } from "./_components/sticky-composer-pill";
import { StudioHomeComposer } from "./_components/studio-home-composer";

// Hero background video — temporarily disabled while a calmer source
// is chosen. Flip to true to re-enable; layout below stays untouched.
const SHOW_BG_VIDEO = false;
const BG_VIDEO_SRC = `${env.STATIC_BASE_URL}/static/pc/1777588432061.mp4`;

export default function StudioHomePage() {
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative">
      {SHOW_BG_VIDEO && (
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-screen overflow-hidden bg-background">
          <video
            src={BG_VIDEO_SRC}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className="h-full w-full scale-105 object-cover object-center opacity-80 blur-sm motion-reduce:hidden"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/20 to-background" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.3)_100%)]" />
        </div>
      )}
      <div className="relative flex min-h-full flex-col gap-16 px-8 pb-24 pt-16">
        <div ref={heroRef}>
          <StudioHomeComposer />
        </div>
        <ProjectsSection />
      </div>
      <StickyComposerPill heroRef={heroRef} />
    </div>
  );
}
