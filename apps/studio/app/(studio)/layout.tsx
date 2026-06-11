import { StudioHeader } from "@/app/_components/studio-header";
import { StudioSidebar } from "@/app/_components/studio-sidebar";

/**
 * Studio chrome (nav rail + header) for the main app surfaces.
 * Immersive surfaces (e.g. /canvas/[id]) live outside this group and
 * render without chrome.
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudioSidebar />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[104px]">
        <StudioHeader />
        {children}
      </div>
    </>
  );
}
