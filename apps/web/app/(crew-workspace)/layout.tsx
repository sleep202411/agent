import { AuthGate } from "@/components/layout/auth-gate";

/**
 * Crew workbench routes deliberately opt out of the public site chrome.
 *
 * The workbench is an immersive production surface: navigation, context,
 * review and collaboration all belong to the crew shell itself. Keeping it
 * in a route group means we do not render-and-hide GlobalNav or SiteFooter,
 * and the public crew pages can continue using the normal `(site)` layout.
 */
export default function CrewWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <main className="h-dvh min-h-0 overflow-hidden bg-[#07080a] text-[#f5f5f6]">{children}</main>
    </AuthGate>
  );
}
