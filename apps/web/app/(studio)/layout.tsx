import { AuthGate } from "@/components/layout/auth-gate";
import { StudioNav } from "@/app/(studio)/_components/studio-nav";

/**
 * Studio route group — isolated from `(site)`. Its own top nav
 * (`StudioNav`) and no SiteFooter. Children render edge-to-edge
 * underneath the studio-private floating sidebar (mounted by
 * `app/(studio)/art-studio/layout.tsx`).
 *
 * Kept intentionally minimal so this slice can be extracted into a
 * standalone Next.js app on its own domain later — see
 * `memory/project_fizzstudio_subdomain.md`.
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <StudioNav />
      <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
    </AuthGate>
  );
}
