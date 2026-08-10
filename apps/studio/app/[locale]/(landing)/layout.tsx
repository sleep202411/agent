import { StudioHeader } from "@/app/_components/studio-header";
import { StudioSidebar } from "@/app/_components/studio-sidebar";
import { StudioSidebarInset } from "@/app/_components/studio-sidebar-context";

/**
 * Chrome for immersive landing surfaces: the shared header overlays each
 * page's full-bleed backdrop. App surfaces mount the exact same header in
 * normal flow; editors retain their task-specific canvas chrome.
 */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudioSidebar />
      <StudioSidebarInset className="relative min-h-screen min-w-0">
        <div className="absolute inset-x-0 top-0 z-40">
          <StudioHeader />
        </div>
        {children}
      </StudioSidebarInset>
    </>
  );
}
