import { StudioHeader } from "@/app/_components/studio-header";
import { StudioSidebar } from "@/app/_components/studio-sidebar";
import { StudioSidebarInset } from "@/app/_components/studio-sidebar-context";

/**
 * Studio chrome (fixed sidebar + the canonical product header) for app surfaces.
 * Immersive surfaces (e.g. /canvas/[id]) live outside this group and
 * render without chrome. The active-workspace context is provided app-wide
 * (app/providers.tsx), so the header switcher + projects grid are scoped to
 * the active workspace (personal or a team the user belongs to).
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudioSidebar />
      <StudioSidebarInset className="flex min-h-screen min-w-0 flex-1 flex-col">
        <StudioHeader />
        {children}
      </StudioSidebarInset>
    </>
  );
}
