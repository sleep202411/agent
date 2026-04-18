"use client";

import { useRef } from "react";
import DotField from "./_components/backgrounds/dot-field";
import { ProjectsSection } from "./_components/projects-section";
import { RecruitmentStrip } from "./_components/recruitment-strip";
import { StickyComposerPill } from "./_components/sticky-composer-pill";
import { StudioHomeComposer } from "./_components/studio-home-composer";

export default function StudioHomePage() {
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0">
        <DotField
          glowColor="transparent"
          bulgeStrength={18}
          cursorRadius={260}
          dotRadius={2}
          dotSpacing={18}
          gradientFrom="rgba(255, 255, 255, 0.25)"
          gradientTo="rgba(255, 255, 255, 0.15)"
        />
      </div>
      <div className="relative z-10 flex min-h-full flex-col gap-16 px-8 pb-24 pt-16">
        <div ref={heroRef}>
          <StudioHomeComposer />
        </div>
        <ProjectsSection />
        <RecruitmentStrip />
      </div>
      <StickyComposerPill heroRef={heroRef} />
    </>
  );
}
