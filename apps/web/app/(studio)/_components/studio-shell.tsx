"use client";

import { usePathname } from "next/navigation";
import { AuthGate } from "@/components/layout/auth-gate";
import { StudioSidebar } from "@/app/(studio)/art-studio/_components/studio-sidebar";
import { StudioNav } from "@/app/(studio)/_components/studio-nav";
import { isArtStudioPath, isProjectWorkspaceChromePath } from "@/src/lib/studio-routes";

/**
 * Owns studio-level chrome for the whole `(studio)` route group.
 *
 * Project workspaces render their own dense production UI
 * (`ProjectHeader` + `ProjectSidebar`) and must not also mount the
 * broader Studio nav/rail. Keeping that decision here avoids CSS
 * hiding and prevents the parent layout from reserving nav height.
 */
export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isWorkspace = isProjectWorkspaceChromePath(pathname);

  return (
    <AuthGate>
      {isWorkspace ? null : <StudioNav />}
      {isWorkspace || !isArtStudioPath(pathname) ? null : <StudioSidebar />}
      <main className={isWorkspace ? "min-h-screen" : "min-h-[calc(100vh-3.5rem)]"}>
        {children}
      </main>
    </AuthGate>
  );
}
