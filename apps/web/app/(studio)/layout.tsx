import { StudioShell } from "@/app/(studio)/_components/studio-shell";

/**
 * Studio route group — isolated from `(site)`. The client shell owns
 * all studio-level chrome so workspace routes can opt out at the
 * layout level instead of hiding header/sidebar with CSS.
 *
 * Kept intentionally minimal so this slice can be extracted into a
 * standalone Next.js app on its own domain later — see
 * `memory/project_fizzstudio_subdomain.md`.
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <StudioShell>{children}</StudioShell>;
}
