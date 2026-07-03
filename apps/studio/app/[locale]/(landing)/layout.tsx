import { LandingHeader } from "@/app/_components/landing-header";
import { StudioSidebar } from "@/app/_components/studio-sidebar";

/**
 * Chrome for the immersive landing surfaces (home, story-studio…): the shared
 * icon rail + the transparent LandingHeader floating over each page's
 * full-bleed backdrop. App surfaces use the (studio) group (solid sticky
 * StudioHeader); editors (canvas, story-studio/editor) stay chrome-less
 * outside both groups.
 */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="absolute inset-x-0 top-0 z-40">
        <LandingHeader />
      </div>
      <StudioSidebar />
      {children}
    </>
  );
}
