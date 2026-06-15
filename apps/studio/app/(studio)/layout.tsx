import { StudioHeader } from "@/app/_components/studio-header";
import { StudioSidebar } from "@/app/_components/studio-sidebar";
import { WorkspaceProvider } from "@/app/_components/workspace-context";

/**
 * Studio chrome (nav rail + header) for the main app surfaces.
 * Immersive surfaces (e.g. /canvas/[id]) live outside this group and
 * render without chrome.
 *
 * WorkspaceProvider scopes the header switcher + projects grid to the
 * active workspace (personal or a team the user belongs to).
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      {/* Header spans the full viewport width (logo at the browser edge);
          only the page content offsets for the nav rail. */}
      <StudioHeader />
      <StudioSidebar />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[104px]">{children}</div>
    </WorkspaceProvider>
  );
}
