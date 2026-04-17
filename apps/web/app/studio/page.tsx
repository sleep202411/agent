import DotField from "./_components/backgrounds/dot-field";
import { RecentProjectsStrip } from "./_components/recent-projects-strip";
import { StudioHomeComposer } from "./_components/studio-home-composer";

export default function StudioHomePage() {
  return (
    <>
      <div className="pointer-events-none fixed inset-y-0 left-16 right-0 z-0">
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
      <div className="relative z-10 flex min-h-full flex-col gap-16 px-8 pb-24 pt-4">
        <StudioHomeComposer />
        <RecentProjectsStrip />
      </div>
    </>
  );
}
