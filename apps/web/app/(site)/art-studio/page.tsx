"use client";

import { useRef } from "react";
import { ProjectsSection } from "./_components/projects-section";
import { StickyComposerPill } from "./_components/sticky-composer-pill";
import { StudioHomeComposer } from "./_components/studio-home-composer";

export default function StudioHomePage() {
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative">
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
